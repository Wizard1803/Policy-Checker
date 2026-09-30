const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_routes';
process.env.ATLAS_URI = process.env.ATLAS_URI || 'mongodb://localhost:27017/testdb';

// Mock DB connection, documentService, models, quotaService, and cloudinary
jest.mock('../config/db', () => jest.fn());
jest.mock('../services/document.service', () => ({
  reconcileOrphanedFiles: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
}));
jest.mock('../models/user.model');
jest.mock('../models/files.model');
jest.mock('../models/conversations.model');
jest.mock('../services/comparison.service');
jest.mock('../services/quota.service', () => ({
  checkAndConsumeQuota: jest.fn().mockResolvedValue({ allowed: true }),
  refundQuota: jest.fn().mockResolvedValue({ refunded: true }),
  TIER_LIMITS: {
    standard: { maxUploads: 5, maxQueries: 30, burst: 30 },
    pro: { maxUploads: 25, maxQueries: 200, burst: 60 },
    unlimited: { maxUploads: Infinity, maxQueries: Infinity, burst: 120 },
  },
}));
jest.mock('../config/cloudinary.config', () => ({
  uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
}));

const User = require('../models/user.model');
const comparisonService = require('../services/comparison.service');
const quotaService = require('../services/quota.service');
const app = require('../app');

describe('Compare Policies Route Endpoints (Feature C & Feature H)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const fileId1 = new mongoose.Types.ObjectId();
  const fileId2 = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();

  const ownerUser = {
    _id: ownerId,
    username: 'owneruser',
    email: 'owner@example.com',
    tier: 'standard',
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

  describe('POST /compare-policies', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app)
        .post('/compare-policies')
        .send({ fileIds: [fileId1.toString(), fileId2.toString()], aspect: 'Room Rent' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/user/login');
    });

    test('returns 400 when comparisonService throws 400 for invalid file count', async () => {
      const err = new Error('Please select between 2 and 3 distinct policies for comparison.');
      err.statusCode = 400;
      comparisonService.comparePolicies.mockRejectedValue(err);

      const res = await request(app)
        .post('/compare-policies')
        .set('Cookie', [`token=${validToken}`])
        .send({ fileIds: [fileId1.toString()], aspect: 'Room Rent' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('between 2 and 3');
      expect(quotaService.refundQuota).toHaveBeenCalledWith(ownerId, 'query');
    });

    test('returns 404 when file is not found or belongs to another user', async () => {
      const err = new Error('One or more selected policies could not be found in your account.');
      err.statusCode = 404;
      comparisonService.comparePolicies.mockRejectedValue(err);

      const res = await request(app)
        .post('/compare-policies')
        .set('Cookie', [`token=${validToken}`])
        .send({ fileIds: [fileId1.toString(), fileId2.toString()] });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('could not be found');
      expect(quotaService.refundQuota).toHaveBeenCalledWith(ownerId, 'query');
    });

    test('returns 409 when a selected policy is still processing', async () => {
      const err = new Error('Policy "StarHealth.pdf" is still processing. Please wait until indexing completes.');
      err.statusCode = 409;
      comparisonService.comparePolicies.mockRejectedValue(err);

      const res = await request(app)
        .post('/compare-policies')
        .set('Cookie', [`token=${validToken}`])
        .send({ fileIds: [fileId1.toString(), fileId2.toString()] });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('still processing');
      expect(quotaService.refundQuota).toHaveBeenCalledWith(ownerId, 'query');
    });

    test('returns 422 when a selected policy has failed processing', async () => {
      const err = new Error('Policy "StarHealth.pdf" processing failed. Please reprocess the document before comparing.');
      err.statusCode = 422;
      comparisonService.comparePolicies.mockRejectedValue(err);

      const res = await request(app)
        .post('/compare-policies')
        .set('Cookie', [`token=${validToken}`])
        .send({ fileIds: [fileId1.toString(), fileId2.toString()] });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('processing failed');
      expect(quotaService.refundQuota).toHaveBeenCalledWith(ownerId, 'query');
    });

    test('returns 200 with comparison payload on valid request', async () => {
      const mockResult = {
        success: true,
        aspect: 'Waiting Periods',
        documents: [
          { id: fileId1, name: 'StarHealth.pdf', pageCount: 12 },
          { id: fileId2, name: 'HdfcErgo.pdf', pageCount: 18 },
        ],
        comparisonResult: '### Executive Summary\nStar Health has shorter waiting periods.',
        citations: [
          {
            documentId: fileId1,
            documentName: 'StarHealth.pdf',
            pageNumber: 4,
            excerpt: 'twenty-four months',
            verified: true,
          },
        ],
        conversationId: conversationId.toString(),
      };

      comparisonService.comparePolicies.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/compare-policies')
        .set('Cookie', [`token=${validToken}`])
        .send({
          fileIds: [fileId1.toString(), fileId2.toString()],
          aspect: 'Waiting Periods',
          createConversation: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aspect).toBe('Waiting Periods');
      expect(res.body.documents).toHaveLength(2);
      expect(res.body.comparisonResult).toContain('Executive Summary');
      expect(res.body.citations).toHaveLength(1);
      expect(res.body.conversationId).toBe(conversationId.toString());
      expect(comparisonService.comparePolicies).toHaveBeenCalledWith(
        ownerId,
        [fileId1.toString(), fileId2.toString()],
        'Waiting Periods',
        true
      );
    });
  });

  describe('POST /compare-policies/chat', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app)
        .post('/compare-policies/chat')
        .send({
          conversationId: conversationId.toString(),
          userMessageText: 'Follow-up query',
        });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/user/login');
    });

    test('returns 200 with assistant response for follow-up question', async () => {
      const mockResult = {
        success: true,
        conversationId: conversationId.toString(),
        assistantMessage: {
          text: 'Policy 1 has 2 years waiting period for cataract.',
          citations: [
            { documentName: 'P1.pdf', pageNumber: 4, excerpt: 'Cataract 24 months' },
          ],
          createdAt: new Date(),
        },
      };
      comparisonService.processComparisonChatTurn.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/compare-policies/chat')
        .set('Cookie', [`token=${validToken}`])
        .send({
          conversationId: conversationId.toString(),
          fileIds: [fileId1.toString(), fileId2.toString()],
          userMessageText: 'What is the cataract waiting period?',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversationId).toBe(conversationId.toString());
      expect(res.body.assistantMessage.text).toContain('cataract');
      expect(comparisonService.processComparisonChatTurn).toHaveBeenCalledWith(
        ownerId,
        conversationId.toString(),
        [fileId1.toString(), fileId2.toString()],
        'What is the cataract waiting period?'
      );
    });

    test('handles service errors and refunds quota on chat failure', async () => {
      const err = new Error('Conversation not found or unauthorized.');
      err.statusCode = 404;
      comparisonService.processComparisonChatTurn.mockRejectedValue(err);

      const res = await request(app)
        .post('/compare-policies/chat')
        .set('Cookie', [`token=${validToken}`])
        .send({
          conversationId: conversationId.toString(),
          userMessageText: 'Invalid turn',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(quotaService.refundQuota).toHaveBeenCalledWith(ownerId, 'query');
    });
  });
});
