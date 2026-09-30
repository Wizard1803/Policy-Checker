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
jest.mock('../services/chat.service');
jest.mock('../config/cloudinary.config', () => ({
  uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
}));

const User = require('../models/user.model');
const { Conversation, Message } = require('../models/conversations.model');
const chatService = require('../services/chat.service');
const app = require('../app');

describe('Chat Route Endpoints (Feature B3)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();

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

  describe('POST /files/:fileId/chat', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app)
        .post(`/files/${fileId}/chat`)
        .send({ message: 'Is knee surgery covered?' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/user/login');
    });

    test('returns error when chatService throws validation or not-found error', async () => {
      const err = new Error('File not found or unauthorized.');
      err.statusCode = 404;
      chatService.processChatTurn.mockRejectedValue(err);

      const res = await request(app)
        .post(`/files/${fileId}/chat`)
        .set('Cookie', [`token=${validToken}`])
        .send({ message: 'What is covered?' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('File not found or unauthorized');
    });

    test('returns 200 with reply and citations on successful chat turn', async () => {
      const mockResult = {
        success: true,
        conversationId,
        reply: {
          text: 'Under Clause 4.2, knee surgery is covered.',
          citations: [
            {
              pageNumber: 14,
              excerpt: 'joint replacement waiting period is 24 months',
              verified: true,
            },
          ],
          tablesCited: [],
        },
      };
      chatService.processChatTurn.mockResolvedValue(mockResult);

      const res = await request(app)
        .post(`/files/${fileId}/chat`)
        .set('Cookie', [`token=${validToken}`])
        .send({ message: 'Is knee surgery covered?', conversationId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversationId).toEqual(conversationId.toString());
      expect(res.body.reply.text).toContain('Under Clause 4.2');
      expect(res.body.reply.citations[0].verified).toBe(true);
    });
  });

  describe('GET /files/:fileId/chat/history', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app).get(`/files/${fileId}/chat/history`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/user/login');
    });

    test('returns empty message list if no active conversation exists', async () => {
      Conversation.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(null),
      });

      const res = await request(app)
        .get(`/files/${fileId}/chat/history`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversationId).toBeNull();
      expect(res.body.messages).toEqual([]);
    });

    test('returns message history when conversation exists', async () => {
      const mockConv = {
        _id: conversationId,
        title: 'Policy Inquiry: Health.pdf',
      };

      const mockMessages = [
        { sender: 'user', text: 'First query' },
        { sender: 'model', text: 'First reply', citations: [] },
      ];

      Conversation.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockConv),
      });

      Message.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMessages),
        }),
      });

      const res = await request(app)
        .get(`/files/${fileId}/chat/history`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversationId).toEqual(conversationId.toString());
      expect(res.body.title).toBe('Policy Inquiry: Health.pdf');
      expect(res.body.messages).toHaveLength(2);
    });
  });

  describe('GET /files/:fileId/conversations', () => {
    test('redirects unauthenticated requests to login', async () => {
      const res = await request(app).get(`/files/${fileId}/conversations`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/user/login');
    });

    test('returns list of conversation sessions for authenticated user', async () => {
      const mockSessions = [
        {
          _id: conversationId,
          title: 'Room Rent Inquiry',
          messageCount: 4,
          updatedAt: new Date().toISOString(),
        },
      ];

      chatService.listConversationsForFile.mockResolvedValue(mockSessions);

      const res = await request(app)
        .get(`/files/${fileId}/conversations`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].title).toBe('Room Rent Inquiry');
      expect(chatService.listConversationsForFile).toHaveBeenCalledWith(ownerId, fileId.toString());
    });

    test('handles service errors gracefully with 500 status', async () => {
      chatService.listConversationsForFile.mockRejectedValue(new Error('Database query failure'));

      const res = await request(app)
        .get(`/files/${fileId}/conversations`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Database query failure');
    });
  });
});
