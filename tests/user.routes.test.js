const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_hardening';
process.env.ATLAS_URI = process.env.ATLAS_URI || 'mongodb://localhost:27017/testdb';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test_gemini_api_key';

// Mock DB connection, services, and models
jest.mock('../config/db', () => jest.fn());
jest.mock('../services/document.service', () => ({
  reconcileOrphanedFiles: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  processDocument: jest.fn().mockResolvedValue({}),
}));
jest.mock('../models/user.model');
jest.mock('../models/files.model');
jest.mock('../models/tables.model', () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockResolvedValue([]),
  }),
}));
jest.mock('../config/cloudinary.config', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
  },
}));

const User = require('../models/user.model');
const app = require('../app');
const {
  pruneExpiredBurstEntries,
  burstCache,
  BURST_WINDOW_MS,
} = require('../middleware/rate-limiter');
const quotaService = require('../services/quota.service');

describe('User Authentication & Security Routes (user.routes.js)', () => {
  const userId = new mongoose.Types.ObjectId();
  const validUser = {
    _id: userId,
    username: 'testuser',
    email: 'user@example.com',
    password: '$2b$10$hashedpasswordstringforuser',
    tier: 'standard',
    usage: { uploadsCount: 2, queriesCount: 10, lastResetDate: new Date() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Email Login & Username Login Support', () => {
    test('allows login with username', async () => {
      User.findOne.mockResolvedValue(validUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      const res = await request(app)
        .post('/user/login')
        .send({ username: 'testuser', password: 'validpassword' });

      expect(User.findOne).toHaveBeenCalledWith({
        $or: [{ username: 'testuser' }, { email: 'testuser' }],
      });
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/');
    });

    test('allows login with email address in the username field', async () => {
      User.findOne.mockResolvedValue(validUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      const res = await request(app)
        .post('/user/login')
        .send({ username: 'user@example.com', password: 'validpassword' });

      expect(User.findOne).toHaveBeenCalledWith({
        $or: [{ username: 'user@example.com' }, { email: 'user@example.com' }],
      });
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/');
    });

    test('returns 401 on incorrect credentials', async () => {
      User.findOne.mockResolvedValue(validUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

      const res = await request(app)
        .post('/user/login')
        .set('Accept', 'application/json')
        .send({ username: 'testuser', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid username or password');
    });
  });

  describe('2. Short Email Validation Support', () => {
    test('accepts valid short email like a@b.co during registration', async () => {
      User.create.mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        username: 'shortemailuser',
        email: 'a@b.co',
      });
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed_pw');

      const res = await request(app)
        .post('/user/register')
        .send({
          username: 'shortemailuser',
          email: 'a@b.co',
          password: 'password123',
        });

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/');
    });

    test('rejects malformed email format', async () => {
      const res = await request(app)
        .post('/user/register')
        .set('Accept', 'application/json')
        .send({
          username: 'bademailuser',
          email: 'not-an-email',
          password: 'password123',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid input data');
    });
  });

  describe('3. Form POST Error Rendering vs JSON API', () => {
    test('renders HTML login page with error when validation fails on browser form POST', async () => {
      const res = await request(app)
        .post('/user/login')
        .set('Accept', 'text/html')
        .send({ username: '', password: '' });

      expect(res.status).toBe(400);
      expect(res.text).toContain('auth-error-banner');
    });

    test('returns JSON 400 when validation fails on API request', async () => {
      const res = await request(app)
        .post('/user/login')
        .set('Accept', 'application/json')
        .send({ username: '', password: '' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid input data');
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    test('renders HTML register page with error when field is duplicate', async () => {
      const duplicateErr = new Error('Duplicate key');
      duplicateErr.code = 11000;
      duplicateErr.keyPattern = { email: 1 };
      User.create.mockRejectedValue(duplicateErr);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed');

      const res = await request(app)
        .post('/user/register')
        .set('Accept', 'text/html')
        .send({
          username: 'existinguser',
          email: 'existing@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(409);
      expect(res.text).toContain('That email is already registered.');
    });
  });

  describe('4. AJAX 401 Behavior vs Browser Navigation', () => {
    test('returns JSON 401 for AJAX request with Accept application/json', async () => {
      const res = await request(app)
        .get('/files/507f1f77bcf86cd799439011/status')
        .set('Accept', 'application/json');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Unauthorized');
    });

    test('returns JSON 401 for request with X-Requested-With XMLHttpRequest', async () => {
      const res = await request(app)
        .get('/files/507f1f77bcf86cd799439011/status')
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Unauthorized');
    });

    test('redirects to /user/login for standard browser navigation without auth', async () => {
      const res = await request(app)
        .get('/files/507f1f77bcf86cd799439011/status')
        .set('Accept', 'text/html,application/xhtml+xml');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/user/login');
    });
  });

  describe('5. Rate Limiter Memory Leak Prevention', () => {
    test('pruneExpiredBurstEntries evicts timestamps older than window', () => {
      burstCache.clear();
      const now = Date.now();

      burstCache.set('stale_ip', [now - BURST_WINDOW_MS - 5000]);
      burstCache.set('active_ip', [now - 1000]);
      burstCache.set('mixed_ip', [now - BURST_WINDOW_MS - 2000, now - 500]);

      const evicted = pruneExpiredBurstEntries(now);

      expect(evicted).toBe(1);
      expect(burstCache.has('stale_ip')).toBe(false);
      expect(burstCache.has('active_ip')).toBe(true);
      expect(burstCache.get('mixed_ip')).toHaveLength(1);

      burstCache.clear();
    });
  });

  describe('6. Atomic Quota Increments & Rollback Safety', () => {
    test('uses findOneAndUpdate with $inc and performs rollback if overflow happens', async () => {
      User.findById.mockResolvedValue({
        _id: userId,
        tier: 'standard',
        usage: { uploadsCount: 14, queriesCount: 5, lastResetDate: new Date() },
      });

      // Simulate findOneAndUpdate returning document after concurrent increment
      User.findOneAndUpdate = jest.fn()
        // First call: atomic increment returns 16 (exceeding limit of 15)
        .mockResolvedValueOnce({
          _id: userId,
          tier: 'standard',
          usage: { uploadsCount: 16, queriesCount: 5, lastResetDate: new Date() },
        })
        // Second call: rollback decrement
        .mockResolvedValueOnce({
          _id: userId,
          tier: 'standard',
          usage: { uploadsCount: 15, queriesCount: 5, lastResetDate: new Date() },
        });

      await expect(
        quotaService.checkAndConsumeQuota(userId, 'upload')
      ).rejects.toMatchObject({
        statusCode: 429,
        code: 'QUOTA_EXCEEDED',
      });

      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        { $inc: { 'usage.uploadsCount': 1 } },
        { new: true }
      );
      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        { $inc: { 'usage.uploadsCount': -1 } }
      );
    });

    test('refundQuota atomically decrements without falling below zero', async () => {
      User.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: userId,
        usage: { uploadsCount: 1, queriesCount: 0 },
      });

      await quotaService.refundQuota(userId, 'upload');

      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId, 'usage.uploadsCount': { $gt: 0 } },
        { $inc: { 'usage.uploadsCount': -1 } },
        { new: true }
      );
    });
  });

  describe('7. Security Headers Baseline', () => {
    test('returns standard security headers on HTTP responses', async () => {
      const res = await request(app).get('/user/login');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    });
  });

  describe('8. Central Error Boundary', () => {
    test('catches unhandled route error and returns structured JSON for API caller', async () => {
      User.findOne.mockImplementation(() => {
        throw new Error('Database connection dropped unexpectedly');
      });

      const res = await request(app)
        .post('/user/login')
        .set('Accept', 'application/json')
        .send({ username: 'anyuser', password: 'password123' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(res.body.message).toBe('Database connection dropped unexpectedly');
    });

    test('catches unhandled route error and renders error page for browser caller', async () => {
      User.findOne.mockImplementation(() => {
        throw new Error('Internal system failure');
      });

      const res = await request(app)
        .post('/user/login')
        .set('Accept', 'text/html')
        .send({ username: 'anyuser', password: 'password123' });

      expect(res.status).toBe(500);
      expect(res.text).toContain('Something Went Wrong');
      expect(res.text).toContain('Internal system failure');
    });
  });

  describe('9. Upload Quota Ordering (Multer First)', () => {
    const validToken = jwt.sign(
      { id: userId.toString(), email: validUser.email, username: validUser.username },
      process.env.JWT_SECRET
    );

    test('rejects non-PDF files without consuming or checking quota', async () => {
      const spyConsume = jest.spyOn(quotaService, 'checkAndConsumeQuota');

      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(validUser),
        then: (resolve, reject) => Promise.resolve(validUser).then(resolve, reject),
      });

      const res = await request(app)
        .post('/upload')
        .set('Cookie', [`token=${validToken}`])
        .attach('policy', Buffer.from('plain text content'), 'not-a-pdf.txt');

      expect(res.status).toBe(400);
      expect(res.text).toContain('Only PDF files are allowed');
      expect(spyConsume).not.toHaveBeenCalled();
    });

    test('rejects empty file upload without consuming quota', async () => {
      const spyConsume = jest.spyOn(quotaService, 'checkAndConsumeQuota');

      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(validUser),
        then: (resolve, reject) => Promise.resolve(validUser).then(resolve, reject),
      });

      const res = await request(app)
        .post('/upload')
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(400);
      expect(res.text).toContain('No file uploaded.');
      expect(spyConsume).not.toHaveBeenCalled();
    });
  });
});
