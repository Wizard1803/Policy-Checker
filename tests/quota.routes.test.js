const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_routes';
process.env.ATLAS_URI = process.env.ATLAS_URI || 'mongodb://localhost:27017/testdb';

// Mock DB connection, documentService, models, and cloudinary
jest.mock('../config/db', () => jest.fn());
jest.mock('../services/document.service', () => ({
  reconcileOrphanedFiles: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  processDocument: jest.fn().mockResolvedValue(),
}));
jest.mock('../models/user.model');
jest.mock('../models/files.model');
jest.mock('../config/cloudinary.config', () => ({
  uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
}));

const User = require('../models/user.model');
const { clearBurstCache } = require('../middleware/rate-limiter');
const app = require('../app');

describe('Quota & Rate Limiter Route Endpoints (Feature G2)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  const standardUser = {
    _id: ownerId,
    username: 'standarduser',
    email: 'standard@example.com',
    tier: 'standard',
    usage: {
      uploadsCount: 0,
      queriesCount: 0,
      lastResetDate: new Date(),
    },
    save: jest.fn().mockResolvedValue(true),
  };

  const validToken = jwt.sign(
    { id: ownerId.toString(), email: standardUser.email, username: standardUser.username },
    process.env.JWT_SECRET
  );

  beforeEach(() => {
    jest.clearAllMocks();
    clearBurstCache();
    delete process.env.ENABLE_BURST_LIMIT_TEST;

    standardUser.usage.uploadsCount = 0;
    standardUser.usage.queriesCount = 0;
    standardUser.tier = 'standard';

    User.findById.mockImplementation((id) => {
      const userDoc = id && id.toString() === ownerId.toString() ? standardUser : null;
      return {
        select: jest.fn().mockResolvedValue(userDoc),
        then: (resolve, reject) => Promise.resolve(userDoc).then(resolve, reject),
      };
    });
  });

  afterAll(() => {
    clearBurstCache();
    delete process.env.ENABLE_BURST_LIMIT_TEST;
  });

  describe('GET /user/quota', () => {
    test('returns 401 when token cookie is missing', async () => {
      const res = await request(app).get('/user/quota');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('returns 200 with usage and tier limits for authenticated user', async () => {
      standardUser.usage.uploadsCount = 3;
      standardUser.usage.queriesCount = 12;

      const res = await request(app)
        .get('/user/quota')
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tier).toBe('standard');
      expect(res.body.uploadsUsed).toBe(3);
      expect(res.body.uploadsLimit).toBe(15);
      expect(res.body.queriesUsed).toBe(12);
      expect(res.body.queriesLimit).toBe(100);
    });
  });

  describe('POST /upload quota enforcement', () => {
    test('returns 429 when upload quota is reached (15/15)', async () => {
      standardUser.usage.uploadsCount = 15;

      const res = await request(app)
        .post('/upload')
        .set('Cookie', [`token=${validToken}`])
        .set('Accept', 'application/json')
        .attach('policy', Buffer.from('%PDF-1.4 test'), 'policy.pdf');

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('QUOTA_EXCEEDED');
      expect(res.body.message).toContain('Monthly upload limit reached');
    });
  });

  describe('POST /files/:fileId/chat quota enforcement', () => {
    test('returns 429 when AI query quota is reached (100/100)', async () => {
      standardUser.usage.queriesCount = 100;

      const res = await request(app)
        .post(`/files/${fileId}/chat`)
        .set('Cookie', [`token=${validToken}`])
        .set('Accept', 'application/json')
        .send({ message: 'What is the room rent limit?' });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('QUOTA_EXCEEDED');
      expect(res.body.message).toContain('Monthly AI query limit reached');
    });
  });

  describe('POST /compare-policies quota enforcement', () => {
    test('returns 429 when AI query quota is reached', async () => {
      standardUser.usage.queriesCount = 100;

      const res = await request(app)
        .post('/compare-policies')
        .set('Cookie', [`token=${validToken}`])
        .set('Accept', 'application/json')
        .send({
          fileIds: [new mongoose.Types.ObjectId().toString(), new mongoose.Types.ObjectId().toString()],
          aspect: 'Exclusions',
        });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('Burst rate limiting', () => {
    test('returns 429 BURST_LIMIT_EXCEEDED when requests exceed burst limit', async () => {
      process.env.ENABLE_BURST_LIMIT_TEST = 'true';
      clearBurstCache();

      // Standard tier burst limit is 20 req/min
      // Send 20 allowed requests
      for (let i = 0; i < 20; i++) {
        await request(app)
          .post(`/files/${fileId}/chat`)
          .set('Cookie', [`token=${validToken}`])
          .send({ message: 'query' });
      }

      // 21st request triggers burst limit
      const res = await request(app)
        .post(`/files/${fileId}/chat`)
        .set('Cookie', [`token=${validToken}`])
        .send({ message: 'query' });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('BURST_LIMIT_EXCEEDED');
      expect(res.headers['retry-after']).toBe('60');
    });
  });
});
