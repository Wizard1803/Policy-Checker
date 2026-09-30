const mongoose = require('mongoose');
const chatService = require('../services/chat.service');
const { Conversation, Message } = require('../models/conversations.model');
const File = require('../models/files.model');
const chunkService = require('../services/chunk.service');
const tableService = require('../services/table.service');
const fetch = require('node-fetch');

jest.mock('node-fetch');
jest.mock('../services/chunk.service');
jest.mock('../services/table.service');

describe('Chat Service - Multi-Turn Policy Chat & Citations (Feature B2)', () => {
  const userId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test_key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe('getOrCreateConversation', () => {
    test('creates new conversation when conversationId is omitted', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        fileName: 'StarHealthPolicy.pdf',
      };
      jest.spyOn(File, 'findOne').mockResolvedValue(mockFile);
      jest.spyOn(Conversation.prototype, 'save').mockResolvedValue(true);

      const conv = await chatService.getOrCreateConversation(userId, fileId);
      expect(conv.uploadedBy).toEqual(userId);
      expect(conv.fileIds).toContain(fileId);
      expect(conv.title).toContain('StarHealthPolicy.pdf');
    });

    test('retrieves existing conversation and adds fileId if not present', async () => {
      const mockConv = {
        _id: conversationId,
        uploadedBy: userId,
        fileIds: [fileId],
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(Conversation, 'findOne').mockResolvedValue(mockConv);

      const conv = await chatService.getOrCreateConversation(userId, fileId, conversationId);
      expect(conv).toBe(mockConv);
      expect(mockConv.save).not.toHaveBeenCalled();
    });

    test('throws 404 if conversation is not found or unauthorized', async () => {
      jest.spyOn(Conversation, 'findOne').mockResolvedValue(null);

      await expect(
        chatService.getOrCreateConversation(userId, fileId, conversationId)
      ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('not found') });
    });
  });

  describe('getRecentTurns', () => {
    test('retrieves up to 6 messages and returns them in chronological order', async () => {
      const mockMessages = [
        { sender: 'model', text: 'Second answer', createdAt: new Date(2000) },
        { sender: 'user', text: 'Second question', createdAt: new Date(1500) },
        { sender: 'model', text: 'First answer', createdAt: new Date(1000) },
        { sender: 'user', text: 'First question', createdAt: new Date(500) },
      ];

      jest.spyOn(Message, 'find').mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([...mockMessages]),
          }),
        }),
      });

      const turns = await chatService.getRecentTurns(conversationId, 3);
      expect(turns).toHaveLength(4);
      // Chronological order: oldest first
      expect(turns[0].text).toBe('First question');
      expect(turns[3].text).toBe('Second answer');
    });
  });

  describe('parseCitationsFromText', () => {
    test('extracts tagged page references with verbatim quotes', () => {
      const mockFile = { _id: fileId, fileName: 'Policy.pdf' };
      const modelText = `Under [Page 14], "the waiting period for joint replacement is twenty-four months".`;

      const citations = chatService.parseCitationsFromText(modelText, mockFile);
      expect(citations).toHaveLength(1);
      expect(citations[0].pageNumber).toBe(14);
      expect(citations[0].excerpt).toBe('the waiting period for joint replacement is twenty-four months');
    });

    test('extracts Key Extracts bullet points', () => {
      const mockFile = { _id: fileId, fileName: 'Policy.pdf' };
      const modelText = `Answer: Yes.
Reasoning: Covered.
Key Extracts:
- Page 8: "Cataract surgery limit shall be Rs 40,000 per eye"`;

      const citations = chatService.parseCitationsFromText(modelText, mockFile);
      expect(citations).toHaveLength(1);
      expect(citations[0].pageNumber).toBe(8);
      expect(citations[0].excerpt).toContain('Cataract surgery limit shall be Rs 40,000 per eye');
    });
  });

  describe('processChatTurn', () => {
    const mockFile = {
      _id: fileId,
      uploadedBy: userId,
      fileName: 'HealthPolicy.pdf',
      processingState: 'ready',
      extractedText: 'Comprehensive policy terms.',
    };

    const mockConv = {
      _id: conversationId,
      uploadedBy: userId,
      fileIds: [fileId],
      save: jest.fn().mockResolvedValue(true),
    };

    beforeEach(() => {
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFile),
      });
      jest.spyOn(Conversation, 'findOne').mockResolvedValue(mockConv);
      jest.spyOn(Conversation, 'findByIdAndUpdate').mockResolvedValue(true);
      jest.spyOn(Message.prototype, 'save').mockResolvedValue(true);

      jest.spyOn(Message, 'find').mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      chunkService.findSimilarChunks.mockResolvedValue([
        { pageNumber: 4, text: 'Inpatient hospitalisation covered up to sum insured.' },
      ]);
      chunkService.formatChunksForPrompt.mockReturnValue('[PASSAGE REF-1 | Page 4]: Inpatient care.');
      tableService.findRelevantTables.mockResolvedValue([]);
      tableService.formatTablesForPrompt.mockReturnValue('');
      chunkService.verifyCitations.mockImplementation((cits) =>
        cits.map((c) => ({ ...c, verified: true }))
      );
    });

    test('validates userMessageText is non-empty', async () => {
      await expect(
        chatService.processChatTurn(userId, fileId, null, '')
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    test('rejects query if document is in processing state (409)', async () => {
      const processingFile = { ...mockFile, processingState: 'processing' };
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(processingFile),
      });

      await expect(
        chatService.processChatTurn(userId, fileId, null, 'What is covered?')
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    test('processes conversational turn, retrieves hybrid context, and returns verified citations', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Answer: Inpatient care is covered.\n\nReasoning: Stated on page 4.\n\nKey Extracts:\n- [Page 4]: "Inpatient hospitalisation covered up to sum insured."',
                    },
                  ],
                },
              },
            ],
          }),
      });

      const result = await chatService.processChatTurn(
        userId,
        fileId,
        conversationId,
        'Is inpatient care covered?'
      );

      expect(result.success).toBe(true);
      expect(result.conversationId).toEqual(conversationId);
      expect(result.reply.text).toContain('Inpatient care is covered');
      expect(result.reply.citations).toHaveLength(1);
      expect(result.reply.citations[0].verified).toBe(true);

      expect(chunkService.findSimilarChunks).toHaveBeenCalledWith(
        fileId,
        userId,
        'Is inpatient care covered?',
        5
      );
      expect(chunkService.verifyCitations).toHaveBeenCalled();
    });

    test('cascades to fallback model when primary model returns 503 Overloaded', async () => {
      // First model: 503 Overload
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: { message: 'High demand overload' } }),
      });

      // Second model (fallback): 200 OK
      fetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Answer: Fallback successful.' }],
                },
              },
            ],
          }),
      });

      const result = await chatService.processChatTurn(
        userId,
        fileId,
        conversationId,
        'What is the copay?'
      );

      expect(result.success).toBe(true);
      expect(result.reply.text).toBe('Answer: Fallback successful.');
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('listConversationsForFile', () => {
    test('returns formatted conversation sessions with messageCount', async () => {
      const conv1Id = new mongoose.Types.ObjectId();
      const conv2Id = new mongoose.Types.ObjectId();

      const mockConversations = [
        {
          _id: conv1Id,
          title: 'Room Rent Limits Inquiry',
          createdAt: new Date('2026-09-10T10:00:00Z'),
          updatedAt: new Date('2026-09-10T10:30:00Z'),
        },
        {
          _id: conv2Id,
          title: 'Cataract Coverage Inquiry',
          createdAt: new Date('2026-09-09T08:00:00Z'),
          updatedAt: new Date('2026-09-09T08:15:00Z'),
        },
      ];

      jest.spyOn(Conversation, 'find').mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockConversations),
        }),
      });

      jest.spyOn(Message, 'aggregate').mockResolvedValue([
        { _id: conv1Id, count: 4 },
        { _id: conv2Id, count: 2 },
      ]);

      const result = await chatService.listConversationsForFile(userId, fileId);

      expect(Conversation.find).toHaveBeenCalledWith({
        fileIds: fileId,
        uploadedBy: userId,
        isArchived: false,
      });

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Room Rent Limits Inquiry');
      expect(result[0].messageCount).toBe(4);
    });

    test('returns empty array if no conversations are found', async () => {
      jest.spyOn(Conversation, 'find').mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await chatService.listConversationsForFile(userId, fileId);
      expect(result).toEqual([]);
    });
  });

  describe('purgeConversationsForFile', () => {
    test('purges single-file conversations and unlinks multi-file conversations', async () => {
      const convSingleId = new mongoose.Types.ObjectId();
      const convMultiId = new mongoose.Types.ObjectId();

      const mockConvs = [
        { _id: convSingleId, fileIds: [fileId] },
        { _id: convMultiId, fileIds: [fileId, new mongoose.Types.ObjectId()] },
      ];

      jest.spyOn(Conversation, 'find').mockResolvedValue(mockConvs);
      jest.spyOn(Message, 'deleteMany').mockResolvedValue({ deletedCount: 5 });
      jest.spyOn(Conversation, 'deleteMany').mockResolvedValue({ deletedCount: 1 });
      jest.spyOn(Conversation, 'updateMany').mockResolvedValue({ modifiedCount: 1 });

      const result = await chatService.purgeConversationsForFile(fileId, userId);

      expect(Conversation.find).toHaveBeenCalledWith({
        uploadedBy: userId,
        fileIds: fileId,
      });
      expect(result).toEqual({ deletedCount: 1, unlinkedCount: 1 });
    });
  });
});
