const mongoose = require('mongoose');
const { Conversation, Message } = require('../models/conversations.model');

describe('Conversations & Messages Schema Validation (Feature B1)', () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const dummyFileId1 = new mongoose.Types.ObjectId();
  const dummyFileId2 = new mongoose.Types.ObjectId();
  const dummyConversationId = new mongoose.Types.ObjectId();

  describe('Conversation Model', () => {
    test('creates a valid conversation with correct defaults', () => {
      const conv = new Conversation({
        uploadedBy: dummyUserId,
        fileIds: [dummyFileId1, dummyFileId2],
      });

      const err = conv.validateSync();
      expect(err).toBeUndefined();
      expect(conv.uploadedBy).toEqual(dummyUserId);
      expect(conv.fileIds).toHaveLength(2);
      expect(conv.title).toBe('Policy Inquiry');
      expect(conv.isArchived).toBe(false);
      expect(conv.createdAt).toBeInstanceOf(Date);
      expect(conv.updatedAt).toBeInstanceOf(Date);
    });

    test('enforces required uploadedBy field', () => {
      const conv = new Conversation({});
      const err = conv.validateSync();

      expect(err).toBeDefined();
      expect(err.errors.uploadedBy).toBeDefined();
    });

    test('trims whitespace from title', () => {
      const conv = new Conversation({
        uploadedBy: dummyUserId,
        title: '   Health Insurance Query   ',
      });

      expect(conv.title).toBe('Health Insurance Query');
    });

    test('defines required compound index for tenant isolation and recency sorting', () => {
      const indexes = Conversation.schema.indexes();
      const hasTenantUpdatedIndex = indexes.some(
        ([idxDef]) => idxDef.uploadedBy === 1 && idxDef.updatedAt === -1
      );
      expect(hasTenantUpdatedIndex).toBe(true);
    });
  });

  describe('Message Model', () => {
    test('creates a valid user message with correct types', () => {
      const msg = new Message({
        conversationId: dummyConversationId,
        sender: 'user',
        text: 'Does this policy cover knee surgery after 2 years?',
      });

      const err = msg.validateSync();
      expect(err).toBeUndefined();
      expect(msg.conversationId).toEqual(dummyConversationId);
      expect(msg.sender).toBe('user');
      expect(msg.text).toContain('knee surgery');
      expect(msg.citations).toEqual([]);
      expect(msg.tablesCited).toEqual([]);
      expect(msg.createdAt).toBeInstanceOf(Date);
    });

    test('creates a valid model message with FACTUM verified citations', () => {
      const msg = new Message({
        conversationId: dummyConversationId,
        sender: 'model',
        text: 'Under Clause 4.2, knee surgery is covered after a 24-month waiting period.',
        citations: [
          {
            documentId: dummyFileId1,
            documentName: 'StarHealthPolicy.pdf',
            pageNumber: 14,
            excerpt: 'waiting period for joint replacement is twenty-four months',
            clauseTitle: 'Specific Ailment Waiting Periods',
            verified: true,
          },
        ],
      });

      const err = msg.validateSync();
      expect(err).toBeUndefined();
      expect(msg.sender).toBe('model');
      expect(msg.citations).toHaveLength(1);
      expect(msg.citations[0].pageNumber).toBe(14);
      expect(msg.citations[0].verified).toBe(true);
      expect(msg.citations[0].clauseTitle).toBe('Specific Ailment Waiting Periods');
    });

    test('enforces required fields (conversationId, sender, text)', () => {
      const msg = new Message({});
      const err = msg.validateSync();

      expect(err).toBeDefined();
      expect(err.errors.conversationId).toBeDefined();
      expect(err.errors.sender).toBeDefined();
      expect(err.errors.text).toBeDefined();
    });

    test('strictly validates sender enum values', () => {
      const invalidMsg = new Message({
        conversationId: dummyConversationId,
        sender: 'assistant', // only 'user' or 'model' allowed
        text: 'Hello',
      });

      const err = invalidMsg.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.sender).toBeDefined();
      expect(err.errors.sender.kind).toBe('enum');
    });

    test('defines required compound index for chronological conversation ordering', () => {
      const indexes = Message.schema.indexes();
      const hasConvCreatedIndex = indexes.some(
        ([idxDef]) => idxDef.conversationId === 1 && idxDef.createdAt === 1
      );
      expect(hasConvCreatedIndex).toBe(true);
    });
  });
});
