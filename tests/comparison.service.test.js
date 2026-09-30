const mongoose = require('mongoose');
const comparisonService = require('../services/comparison.service');
const File = require('../models/files.model');
const { Conversation, Message } = require('../models/conversations.model');
const chunkService = require('../services/chunk.service');
const tableService = require('../services/table.service');
const fetch = require('node-fetch');

jest.mock('node-fetch');
jest.mock('../services/chunk.service');
jest.mock('../services/table.service');

describe('Comparison Service - Multi-Document Policy Comparison (Feature C1)', () => {
  const userId = new mongoose.Types.ObjectId();
  const fileId1 = new mongoose.Types.ObjectId();
  const fileId2 = new mongoose.Types.ObjectId();
  const fileId3 = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test_key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe('validateComparisonFiles', () => {
    test('throws 400 when fileIds is not an array or has fewer than 2 items', async () => {
      await expect(
        comparisonService.validateComparisonFiles(userId, null)
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('between 2 and 3') });

      await expect(
        comparisonService.validateComparisonFiles(userId, [fileId1.toString()])
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('between 2 and 3') });
    });

    test('throws 400 when fileIds has more than 3 items', async () => {
      const fileId4 = new mongoose.Types.ObjectId();
      await expect(
        comparisonService.validateComparisonFiles(userId, [
          fileId1.toString(),
          fileId2.toString(),
          fileId3.toString(),
          fileId4.toString(),
        ])
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('between 2 and 3') });
    });

    test('throws 400 when duplicate policy IDs are passed', async () => {
      await expect(
        comparisonService.validateComparisonFiles(userId, [fileId1.toString(), fileId1.toString()])
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Duplicate') });
    });

    test('throws 400 when any file ID is not a valid ObjectId', async () => {
      await expect(
        comparisonService.validateComparisonFiles(userId, [fileId1.toString(), 'invalid-id-xyz'])
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Invalid policy identifier') });
    });

    test('throws 404 when one or more files are missing or belong to another user', async () => {
      jest.spyOn(File, 'find').mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: fileId1, fileName: 'Policy1.pdf', uploadedBy: userId, processingState: 'ready' },
        ]),
      });

      await expect(
        comparisonService.validateComparisonFiles(userId, [fileId1.toString(), fileId2.toString()])
      ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('could not be found') });
    });

    test('throws 409 when any selected file is currently processing', async () => {
      jest.spyOn(File, 'find').mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: fileId1, fileName: 'Policy1.pdf', uploadedBy: userId, processingState: 'ready' },
          { _id: fileId2, fileName: 'Policy2.pdf', uploadedBy: userId, processingState: 'processing' },
        ]),
      });

      await expect(
        comparisonService.validateComparisonFiles(userId, [fileId1.toString(), fileId2.toString()])
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('still processing') });
    });

    test('throws 422 when any selected file has failed processing', async () => {
      jest.spyOn(File, 'find').mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: fileId1, fileName: 'Policy1.pdf', uploadedBy: userId, processingState: 'ready' },
          { _id: fileId2, fileName: 'Policy2.pdf', uploadedBy: userId, processingState: 'failed' },
        ]),
      });

      await expect(
        comparisonService.validateComparisonFiles(userId, [fileId1.toString(), fileId2.toString()])
      ).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('processing failed') });
    });

    test('returns ordered files preserving user input sequence', async () => {
      const mockDoc1 = { _id: fileId1, fileName: 'Policy1.pdf', uploadedBy: userId, processingState: 'ready' };
      const mockDoc2 = { _id: fileId2, fileName: 'Policy2.pdf', uploadedBy: userId, processingState: 'ready' };

      // DB returns in reverse order
      jest.spyOn(File, 'find').mockReturnValue({
        select: jest.fn().mockResolvedValue([mockDoc2, mockDoc1]),
      });

      const result = await comparisonService.validateComparisonFiles(userId, [fileId1.toString(), fileId2.toString()]);
      expect(result).toHaveLength(2);
      expect(result[0]._id.toString()).toBe(fileId1.toString());
      expect(result[1]._id.toString()).toBe(fileId2.toString());
    });
  });

  describe('retrieveSymmetricContext', () => {
    test('retrieves independent quota of chunks and tables for each policy', async () => {
      const files = [
        { _id: fileId1, fileName: 'StarHealth.pdf', extractedText: 'Star Health extracted' },
        { _id: fileId2, fileName: 'HdfcErgo.pdf', extractedText: 'HDFC Ergo extracted' },
      ];

      chunkService.findSimilarChunks
        .mockResolvedValueOnce([
          { chunkIndex: 0, pageNumber: 4, text: 'Star Health waiting period clause' },
        ])
        .mockResolvedValueOnce([
          { chunkIndex: 0, pageNumber: 7, text: 'HDFC Ergo waiting period clause' },
        ]);

      tableService.findRelevantTables
        .mockResolvedValueOnce([
          { title: 'Room Rent', pageNumber: 12, markdownRepresentation: '| Plan | Limit |\n| A | 1% |' },
        ])
        .mockResolvedValueOnce([]);

      const { retrievedDocs, formattedContextBlock } = await comparisonService.retrieveSymmetricContext(
        userId,
        files,
        'Waiting Periods'
      );

      expect(retrievedDocs).toHaveLength(2);
      expect(chunkService.findSimilarChunks).toHaveBeenCalledTimes(2);
      expect(tableService.findRelevantTables).toHaveBeenCalledTimes(2);

      // Verify namespaced boundaries
      expect(formattedContextBlock).toContain('[POLICY-1: StarHealth.pdf');
      expect(formattedContextBlock).toContain('[POLICY-2: HdfcErgo.pdf');
      expect(formattedContextBlock).toContain('Star Health waiting period clause');
      expect(formattedContextBlock).toContain('HDFC Ergo waiting period clause');
      expect(formattedContextBlock).toContain('[POLICY-1:TABLE-1 | Page 12 | Room Rent]');
    });
  });

  describe('parseAndVerifyMultiDocCitations', () => {
    test('extracts and verifies citations strictly against matching document namespace', () => {
      const retrievedDocs = [
        {
          index: 1,
          file: { _id: fileId1, fileName: 'StarHealth.pdf' },
          chunks: [{ text: 'The waiting period for pre-existing diseases is twenty-four months.' }],
          tables: [],
        },
        {
          index: 2,
          file: { _id: fileId2, fileName: 'HdfcErgo.pdf' },
          chunks: [{ text: 'Pre-existing conditions are covered after thirty-six months continuous coverage.' }],
          tables: [],
        },
      ];

      const modelText = `
### Comparison
Under [POLICY-1 | Page 4], "the waiting period for pre-existing diseases is twenty-four months".
Conversely, [POLICY-2 | Page 8] states "Pre-existing conditions are covered after thirty-six months".
And unverified claim [POLICY-1 | Page 9] says "free health checkup every six months".
`;

      const citations = comparisonService.parseAndVerifyMultiDocCitations(modelText, retrievedDocs);

      expect(citations).toHaveLength(2);
      expect(citations[0].documentName).toBe('StarHealth.pdf');
      expect(citations[0].pageNumber).toBe(4);
      expect(citations[0].verified).toBe(true);

      expect(citations[1].documentName).toBe('HdfcErgo.pdf');
      expect(citations[1].pageNumber).toBe(8);
      expect(citations[1].verified).toBe(true);
    });
  });

  describe('comparePolicies', () => {
    test('throws 500 if GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;

      const mockDoc1 = { _id: fileId1, fileName: 'Policy1.pdf', uploadedBy: userId, processingState: 'ready' };
      const mockDoc2 = { _id: fileId2, fileName: 'Policy2.pdf', uploadedBy: userId, processingState: 'ready' };
      jest.spyOn(File, 'find').mockReturnValue({ select: jest.fn().mockResolvedValue([mockDoc1, mockDoc2]) });
      chunkService.findSimilarChunks.mockResolvedValue([]);
      tableService.findRelevantTables.mockResolvedValue([]);

      await expect(
        comparisonService.comparePolicies(userId, [fileId1.toString(), fileId2.toString()], 'Limits')
      ).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('GEMINI_API_KEY') });
    });

    test('successfully compares policies and returns structured payload', async () => {
      const mockDoc1 = { _id: fileId1, fileName: 'StarHealth.pdf', uploadedBy: userId, processingState: 'ready', pageCount: 15 };
      const mockDoc2 = { _id: fileId2, fileName: 'HdfcErgo.pdf', uploadedBy: userId, processingState: 'ready', pageCount: 22 };
      jest.spyOn(File, 'find').mockReturnValue({ select: jest.fn().mockResolvedValue([mockDoc1, mockDoc2]) });

      chunkService.findSimilarChunks
        .mockResolvedValueOnce([{ text: 'room rent is capped at one percent of sum insured', pageNumber: 5 }])
        .mockResolvedValueOnce([{ text: 'no capping on room rent for any category', pageNumber: 8 }]);
      tableService.findRelevantTables.mockResolvedValue([]);

      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: `### 1. Executive Summary
Star Health caps room rent, whereas HDFC Ergo provides unlimited room rent.

### 2. Side-by-Side Comparison Matrix
| Parameter | Star Health | HDFC Ergo | Advantage |
| :--- | :--- | :--- | :--- |
| Room Rent | 1% Cap | No Cap | HDFC Ergo |

### 3. Detailed Analysis
According to [POLICY-1 | Page 5], "room rent is capped at one percent of sum insured".
Under [POLICY-2 | Page 8], "no capping on room rent for any category".`,
                },
              ],
            },
          },
        ],
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      });

      const result = await comparisonService.comparePolicies(
        userId,
        [fileId1.toString(), fileId2.toString()],
        'Room Rent'
      );

      expect(result.success).toBe(true);
      expect(result.aspect).toBe('Room Rent');
      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].name).toBe('StarHealth.pdf');
      expect(result.documents[1].name).toBe('HdfcErgo.pdf');
      expect(result.comparisonResult).toContain('Executive Summary');
      expect(result.citations).toHaveLength(2);
      expect(result.citations[0].verified).toBe(true);
      expect(result.conversationId).toBeNull();
    });

    test('creates conversation thread when createConversation is true', async () => {
      const mockDoc1 = { _id: fileId1, fileName: 'Policy1.pdf', uploadedBy: userId, processingState: 'ready' };
      const mockDoc2 = { _id: fileId2, fileName: 'Policy2.pdf', uploadedBy: userId, processingState: 'ready' };
      jest.spyOn(File, 'find').mockReturnValue({ select: jest.fn().mockResolvedValue([mockDoc1, mockDoc2]) });
      chunkService.findSimilarChunks.mockResolvedValue([]);
      tableService.findRelevantTables.mockResolvedValue([]);

      const mockApiResponse = {
        candidates: [{ content: { parts: [{ text: '### 1. Executive Summary\nBoth policies are balanced.' }] } }],
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      });

      jest.spyOn(Conversation.prototype, 'save').mockResolvedValue(true);
      jest.spyOn(Message.prototype, 'save').mockResolvedValue(true);

      const result = await comparisonService.comparePolicies(
        userId,
        [fileId1.toString(), fileId2.toString()],
        'General Coverage',
        true
      );

      expect(result.success).toBe(true);
      expect(result.conversationId).toBeDefined();
    });

    test('cascades to fallback model when primary model returns 503', async () => {
      const mockDoc1 = { _id: fileId1, fileName: 'Policy1.pdf', uploadedBy: userId, processingState: 'ready' };
      const mockDoc2 = { _id: fileId2, fileName: 'Policy2.pdf', uploadedBy: userId, processingState: 'ready' };
      jest.spyOn(File, 'find').mockReturnValue({ select: jest.fn().mockResolvedValue([mockDoc1, mockDoc2]) });
      chunkService.findSimilarChunks.mockResolvedValue([]);
      tableService.findRelevantTables.mockResolvedValue([]);

      // Model 1 returns 503 Overloaded
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue(JSON.stringify({ error: { message: 'High demand overload' } })),
      });

      // Model 2 succeeds
      fetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Fallback model comparison output.' }] } }],
          })
        ),
      });

      const result = await comparisonService.comparePolicies(
        userId,
        [fileId1.toString(), fileId2.toString()],
        'Waiting Period'
      );

      expect(result.success).toBe(true);
      expect(result.comparisonResult).toBe('Fallback model comparison output.');
    });
  });

  describe('processComparisonChatTurn', () => {
    const convId = new mongoose.Types.ObjectId();

    it('throws 400 when userMessageText is empty or whitespace', async () => {
      await expect(
        comparisonService.processComparisonChatTurn(userId, convId, [fileId1, fileId2], '   ')
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Message text cannot be empty') });
    });

    it('throws 400 when conversationId is invalid', async () => {
      await expect(
        comparisonService.processComparisonChatTurn(userId, 'invalid-id', [fileId1, fileId2], 'Follow-up question?')
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Invalid conversation ID') });
    });

    it('throws 404 when conversation does not exist or is unauthorized', async () => {
      jest.spyOn(Conversation, 'findOne').mockResolvedValueOnce(null);

      await expect(
        comparisonService.processComparisonChatTurn(userId, convId, [fileId1, fileId2], 'Follow-up question?')
      ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('Conversation not found or unauthorized') });
    });

    it('successfully processes follow-up turn across multiple policies', async () => {
      const mockConv = {
        _id: convId,
        uploadedBy: userId,
        fileIds: [fileId1, fileId2],
      };
      jest.spyOn(Conversation, 'findOne').mockResolvedValueOnce(mockConv);
      jest.spyOn(Message.prototype, 'save').mockResolvedValue(true);

      jest.spyOn(Message, 'find').mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            { sender: 'user', text: 'Initial compare question' },
            { sender: 'model', text: 'Initial comparison answer' },
          ]),
        }),
      });

      File.find.mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: fileId1, fileName: 'Policy1.pdf', processingState: 'ready' },
          { _id: fileId2, fileName: 'Policy2.pdf', processingState: 'ready' },
        ]),
      });

      chunkService.findSimilarChunks.mockResolvedValue([
        { text: 'Policy 1 cataract waiting period is 2 years.', pageNumber: 5 },
      ]);
      tableService.findRelevantTables.mockResolvedValue([]);

      fetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Policy 1 has a 2-year waiting period for cataract while Policy 2 covers it after 1 year.' }] } }],
          })
        ),
      });

      const result = await comparisonService.processComparisonChatTurn(
        userId,
        convId,
        [fileId1.toString(), fileId2.toString()],
        'Which has shorter cataract waiting period?'
      );

      expect(result.success).toBe(true);
      expect(result.conversationId).toEqual(convId);
      expect(result.assistantMessage.text).toContain('Policy 1 has a 2-year waiting period');
    });
  });
});
