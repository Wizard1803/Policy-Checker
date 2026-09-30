const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_routes';
process.env.ATLAS_URI = process.env.ATLAS_URI || 'mongodb://localhost:27017/testdb';

// Mock DB connection, documentService, models, and cloudinary
jest.mock('../config/db', () => jest.fn());
jest.mock('../services/document.service', () => ({
  reconcileOrphanedFiles: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
}));
jest.mock('../models/user.model');
jest.mock('../models/conversations.model');
jest.mock('../services/search.service');
jest.mock('../config/cloudinary.config', () => ({
  uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
}));

const User = require('../models/user.model');
const searchService = require('../services/search.service');
const app = require('../app');

describe('Search Route Endpoints - Direct Clause Search (Feature F2)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  const ownerUser = {
    _id: ownerId,
    username: 'owneruser',
    email: 'owner@example.com',
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

  describe('GET /files/:fileId/search', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app).get(`/files/${fileId}/search?q=cataract`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/user/login');
    });

    test('returns 400 when search query q is missing or empty', async () => {
      const err = new Error('Search query is required.');
      err.statusCode = 400;
      searchService.searchPolicyClauses.mockRejectedValue(err);

      const res = await request(app)
        .get(`/files/${fileId}/search`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Search query is required.');
    });

    test('returns 404 when file is not found or unauthorized', async () => {
      const err = new Error('File not found or unauthorized.');
      err.statusCode = 404;
      searchService.searchPolicyClauses.mockRejectedValue(err);

      const res = await request(app)
        .get(`/files/${fileId}/search?q=icu`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('not found');
    });

    test('returns 409 when file is still processing', async () => {
      const err = new Error('Document is currently being processed.');
      err.statusCode = 409;
      searchService.searchPolicyClauses.mockRejectedValue(err);

      const res = await request(app)
        .get(`/files/${fileId}/search?q=maternity`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('currently being processed');
    });

    test('returns 200 with search results on valid query', async () => {
      const mockResult = {
        success: true,
        fileId: fileId.toString(),
        fileName: 'Star_Health.pdf',
        query: 'waiting period',
        count: 2,
        totalResults: 2,
        executionTimeMs: 14,
        results: [
          {
            type: 'passage',
            pageNumber: 4,
            chunkIndex: 1,
            score: 0.91,
            relevancePercent: 91,
            text: 'PED waiting period is 36 months.',
            snippet: '...PED waiting period is 36 months...',
          },
          {
            type: 'table',
            pageNumber: 8,
            title: 'Waiting Period Schedule',
            score: 0.95,
            relevancePercent: 95,
            text: '| Period | Disease |\n| 24 Mo | Hernia |',
            snippet: '[Actuarial Table] Waiting Period Schedule on Page 8',
          },
        ],
      };

      searchService.searchPolicyClauses.mockResolvedValue(mockResult);

      const res = await request(app)
        .get(`/files/${fileId}/search?q=waiting%20period&limit=5`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.query).toBe('waiting period');
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0].relevancePercent).toBe(91);
      expect(searchService.searchPolicyClauses).toHaveBeenCalledWith(
        fileId.toString(),
        ownerId,
        'waiting period',
        { limit: '5' }
      );
    });
  });
});
