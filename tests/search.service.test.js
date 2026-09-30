const mongoose = require('mongoose');
const searchService = require('../services/search.service');
const File = require('../models/files.model');
const chunkService = require('../services/chunk.service');
const tableService = require('../services/table.service');

jest.mock('../services/chunk.service');
jest.mock('../services/table.service');

describe('Search Service - Direct Semantic Clause Search (Feature F1)', () => {
  const userId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractSnippet', () => {
    test('extracts snippet centered near matching query term', () => {
      const text = 'This policy provides inpatient hospitalization benefits. Section 4 covers pre-existing conditions after thirty-six months. Room rent is capped.';
      const snippet = searchService.extractSnippet(text, 'pre-existing');
      expect(snippet.toLowerCase()).toContain('pre-existing');
    });

    test('handles empty or missing query safely', () => {
      const text = 'Simple policy text.';
      const snippet = searchService.extractSnippet(text, '');
      expect(snippet).toBe(text);
    });

    test('returns empty string if text is invalid', () => {
      expect(searchService.extractSnippet(null, 'test')).toBe('');
    });
  });

  describe('searchPolicyClauses', () => {
    test('throws 400 when query is empty or whitespace only', async () => {
      await expect(
        searchService.searchPolicyClauses(fileId, userId, '   ')
      ).rejects.toMatchObject({ statusCode: 400, message: 'Search query is required.' });
    });

    test('throws 404 when file is not found or unauthorized', async () => {
      jest.spyOn(File, 'findOne').mockResolvedValue(null);

      await expect(
        searchService.searchPolicyClauses(fileId, userId, 'cataract surgery')
      ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('not found') });
    });

    test('throws 409 when file is currently in processing state', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'processing',
      };
      jest.spyOn(File, 'findOne').mockResolvedValue(mockFile);

      await expect(
        searchService.searchPolicyClauses(fileId, userId, 'room rent')
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('currently being processed') });
    });

    test('throws 422 when file failed processing', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'failed',
        processingError: 'OCR extraction failed.',
      };
      jest.spyOn(File, 'findOne').mockResolvedValue(mockFile);

      await expect(
        searchService.searchPolicyClauses(fileId, userId, 'ambulance')
      ).rejects.toMatchObject({ statusCode: 422, message: 'OCR extraction failed.' });
    });

    test('successfully retrieves ranked passages and tables matching query', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        fileName: 'Star_Health_Optima.pdf',
        processingState: 'ready',
      };
      jest.spyOn(File, 'findOne').mockResolvedValue(mockFile);

      const mockChunks = [
        {
          pageNumber: 3,
          chunkIndex: 1,
          text: 'Clause 4: Cataract surgery is covered up to INR 40,000 per eye.',
          embedding: [0.1, 0.2, 0.3],
        },
        {
          pageNumber: 7,
          chunkIndex: 4,
          text: 'Section 8: General exclusions include cosmetic and dental procedures.',
          embedding: [0.4, 0.5, 0.6],
        },
      ];

      const mockTables = [
        {
          pageNumber: 12,
          title: 'Specific Ailment Sub-limits',
          markdownRepresentation: '| Ailment | Cap |\n| Cataract | 40000 |',
        },
      ];

      chunkService.findSimilarChunks.mockResolvedValue(mockChunks);
      chunkService.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
      chunkService.cosineSimilarity
        .mockReturnValueOnce(0.92)
        .mockReturnValueOnce(0.65);
      tableService.findRelevantTables.mockResolvedValue(mockTables);

      const result = await searchService.searchPolicyClauses(fileId, userId, 'cataract sub-limit', { limit: 5 });

      expect(result.success).toBe(true);
      expect(result.fileName).toBe('Star_Health_Optima.pdf');
      expect(result.query).toBe('cataract sub-limit');
      expect(result.results.length).toBeGreaterThanOrEqual(2);
      expect(result.results[0].score).toBeGreaterThanOrEqual(result.results[1].score);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.results.some((r) => r.type === 'table')).toBe(true);
      expect(result.results.some((r) => r.type === 'passage')).toBe(true);
    });

    test('searchPolicyClauses executes embedQuery exactly once and passes precomputed vector to findSimilarChunks', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        fileName: 'Star_Policy.pdf',
        processingState: 'ready',
      };
      jest.spyOn(File, 'findOne').mockResolvedValue(mockFile);

      const dummyVec = [0.1, 0.2, 0.3];
      chunkService.embedQuery.mockResolvedValueOnce(dummyVec);
      chunkService.findSimilarChunks.mockResolvedValue([]);
      tableService.findRelevantTables.mockResolvedValue([]);

      const result = await searchService.searchPolicyClauses(fileId, userId, 'waiting period', { limit: 5 });

      expect(result.success).toBe(true);
      expect(chunkService.embedQuery).toHaveBeenCalledTimes(1);
      expect(chunkService.findSimilarChunks).toHaveBeenCalledWith(
        fileId,
        userId,
        'waiting period',
        10,
        expect.objectContaining({ queryEmbedding: dummyVec })
      );
    });
  });
});
