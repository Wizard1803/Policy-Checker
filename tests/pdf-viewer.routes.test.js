const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_routes';
process.env.ATLAS_URI = process.env.ATLAS_URI || 'mongodb://localhost:27017/testdb';

// Mock DB connection, documentService, models, and node-fetch
jest.mock('../config/db', () => jest.fn());
jest.mock('../services/document.service', () => ({
  reconcileOrphanedFiles: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  processDocument: jest.fn().mockResolvedValue({}),
}));
jest.mock('../models/user.model');
jest.mock('../models/files.model');
jest.mock('node-fetch');

const User = require('../models/user.model');
const File = require('../models/files.model');
const fetch = require('node-fetch');
const app = require('../app');

describe('In-App PDF Viewer Stream Route Endpoints (Feature I)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const strangerId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  const ownerUser = {
    _id: ownerId,
    username: 'owneruser',
    email: 'owner@example.com',
    tier: 'standard',
    usage: { uploadsCount: 0, queriesCount: 0, lastResetDate: new Date() },
  };

  const validToken = jwt.sign(
    { id: ownerId.toString(), email: ownerUser.email, username: ownerUser.username },
    process.env.JWT_SECRET
  );

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockImplementation((id) => {
      const userDoc = id && id.toString() === ownerId.toString() ? ownerUser : null;
      return {
        select: jest.fn().mockResolvedValue(userDoc),
        then: (resolve, reject) => Promise.resolve(userDoc).then(resolve, reject),
      };
    });
  });

  describe('GET /files/:fileId/view-pdf', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app).get(`/files/${fileId}/view-pdf`);
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/user/login');
    });

    test('returns 404 if file is not found', async () => {
      File.findById.mockResolvedValue(null);

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/File not found or unauthorized/i);
    });

    test('returns 404 if file belongs to another user (tenant isolation)', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        fileName: 'Secret_Policy.pdf',
        uploadedBy: strangerId,
        processingState: 'ready',
        fileUrl: 'https://cloudinary.com/secret.pdf',
      });

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/File not found or unauthorized/i);
    });

    test('successfully streams document during processing state (progressive document availability)', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        fileName: 'Pending_Policy.pdf',
        uploadedBy: ownerId,
        processingState: 'processing',
        fileUrl: 'https://cloudinary.com/pending.pdf',
      });

      const fakePdfBuffer = Buffer.from('%PDF-1.4 progressive streamed policy');
      fetch.mockResolvedValue({
        ok: true,
        buffer: async () => fakePdfBuffer,
      });

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toBe('application/pdf');
      expect(res.header['content-disposition']).toBe('inline; filename="Pending_Policy.pdf"');
      expect(res.header['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.body).toEqual(fakePdfBuffer);
    });

    test('returns 422 if document extraction failed', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        fileName: 'Corrupt_Policy.pdf',
        uploadedBy: ownerId,
        processingState: 'failed',
        fileUrl: 'https://cloudinary.com/corrupt.pdf',
      });

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/processing failed/i);
    });

    test('returns 404 if fileUrl is missing', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        fileName: 'NoUrl_Policy.pdf',
        uploadedBy: ownerId,
        processingState: 'ready',
        fileUrl: null,
      });

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/File URL not found/i);
    });

    test('returns 502 if remote storage fetch fails', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        fileName: 'Health_Policy.pdf',
        uploadedBy: ownerId,
        processingState: 'ready',
        fileUrl: 'https://cloudinary.com/raw.pdf',
      });

      fetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Failed to retrieve document from storage/i);
    });

    test('successfully streams inline PDF with correct headers and sanitized filename', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        fileName: 'Health Policy & Care (2026).pdf',
        uploadedBy: ownerId,
        processingState: 'ready',
        fileUrl: 'https://cloudinary.com/health.pdf',
      });

      const fakePdfBuffer = Buffer.from('%PDF-1.4 sample policy test stream');
      fetch.mockResolvedValue({
        ok: true,
        buffer: async () => fakePdfBuffer,
      });

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toBe('application/pdf');
      expect(res.header['content-disposition']).toBe('inline; filename="Health_Policy___Care__2026_.pdf"');
      expect(res.header['cache-control']).toBe('private, max-age=3600');
      expect(res.body).toEqual(fakePdfBuffer);
    });

    test('successfully pipes stream when response.body is a readable stream', async () => {
      const { Readable } = require('stream');
      File.findById.mockResolvedValue({
        _id: fileId,
        fileName: 'Streamed_Policy.pdf',
        uploadedBy: ownerId,
        processingState: 'ready',
        fileUrl: 'https://cloudinary.com/streamed.pdf',
      });

      const fakePdfBuffer = Buffer.from('%PDF-1.4 sample streamed policy chunk');
      const stream = Readable.from([fakePdfBuffer]);

      fetch.mockResolvedValue({
        ok: true,
        body: stream,
      });

      const res = await request(app)
        .get(`/files/${fileId}/view-pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toBe('application/pdf');
      expect(res.header['content-disposition']).toBe('inline; filename="Streamed_Policy.pdf"');
      expect(res.header['cache-control']).toBe('private, max-age=3600');
      expect(res.body).toEqual(fakePdfBuffer);
    });
  });
});
