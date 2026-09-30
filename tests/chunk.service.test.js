const mongoose = require('mongoose');
const chunkService = require('../services/chunk.service');
const Chunk = require('../models/chunks.model');
const fetch = require('node-fetch');

jest.mock('node-fetch');

describe('Chunk Service - Vector RAG & Adaptive Chunking (Feature A2)', () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const dummyFileId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockReset();
    delete process.env.GEMINI_API_KEY;
  });

  describe('createChunksFromPages', () => {
    test('returns empty array for empty or invalid input', () => {
      expect(chunkService.createChunksFromPages([])).toEqual([]);
      expect(chunkService.createChunksFromPages(null)).toEqual([]);
    });

    test('creates single chunk for compact page text within page boundary', () => {
      const pages = [
        { pageNumber: 1, text: 'This is a short policy overview page explaining basic benefits.' },
        { pageNumber: 2, text: 'This is another distinct page explaining definitions and terms.' },
      ];

      const chunks = chunkService.createChunksFromPages(pages);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].pageNumber).toBe(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].text).toContain('short policy overview');
      expect(chunks[0].charLength).toBe(pages[0].text.length);

      expect(chunks[1].pageNumber).toBe(2);
      expect(chunks[1].chunkIndex).toBe(1);
      expect(chunks[1].text).toContain('distinct page explaining definitions');
    });

    test('splits dense page (> 400 words) using sliding window with overlap without crossing page boundary', () => {
      // Generate 800 words on page 1
      const words = Array.from({ length: 800 }, (_, i) => `word${i}`);
      const pageText = words.join(' ');

      const chunks = chunkService.createChunksFromPages([{ pageNumber: 1, text: pageText }]);
      expect(chunks.length).toBeGreaterThan(1);

      // Verify all chunks preserve pageNumber = 1
      for (const chunk of chunks) {
        expect(chunk.pageNumber).toBe(1);
        expect(chunk.text.split(/\s+/).length).toBeLessThanOrEqual(350);
      }

      // Check overlap between consecutive chunks
      const firstChunkWords = chunks[0].text.split(/\s+/);
      const secondChunkWords = chunks[1].text.split(/\s+/);
      const overlapWord = firstChunkWords[firstChunkWords.length - 1];
      expect(secondChunkWords).toContain(overlapWord);
    });
  });

  describe('cosineSimilarity', () => {
    test('computes identical vectors as 1.0', () => {
      const vecA = [0.2, 0.4, 0.8];
      const sim = chunkService.cosineSimilarity(vecA, vecA);
      expect(sim).toBeCloseTo(1.0, 5);
    });

    test('computes orthogonal vectors as 0', () => {
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];
      expect(chunkService.cosineSimilarity(vecA, vecB)).toBe(0);
    });

    test('handles empty or zero vectors gracefully without NaN', () => {
      expect(chunkService.cosineSimilarity([], [])).toBe(0);
      expect(chunkService.cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
    });
  });

  describe('generateEmbeddings', () => {
    test('returns null if GEMINI_API_KEY is not set', async () => {
      const res = await chunkService.generateEmbeddings(['sample text']);
      expect(res).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('calls batchEmbedContents and extracts 768d vectors when API key is set', async () => {
      process.env.GEMINI_API_KEY = 'test_key';
      const dummyVec = new Array(768).fill(0.05);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [{ values: dummyVec }],
        }),
      });

      const res = await chunkService.generateEmbeddings(['sample policy text']);
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual(dummyVec);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('handles API HTTP error gracefully without throwing', async () => {
      process.env.GEMINI_API_KEY = 'test_key';
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const res = await chunkService.generateEmbeddings(['sample policy text']);
      expect(res).toBeNull();
    });
  });

  describe('embedQuery', () => {
    test('returns null if query is empty or API key is missing', async () => {
      expect(await chunkService.embedQuery('')).toBeNull();
      expect(await chunkService.embedQuery('valid query text')).toBeNull();
    });

    test('returns query embedding vector on successful API response', async () => {
      process.env.GEMINI_API_KEY = 'test_key';
      const dummyVec = new Array(768).fill(0.02);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embedding: { values: dummyVec },
        }),
      });

      const res = await chunkService.embedQuery('What is waiting period?');
      expect(res).toEqual(dummyVec);
    });
  });

  describe('findSimilarChunks', () => {
    test('returns all chunks directly if count <= limit', async () => {
      const mockChunks = [
        { _id: new mongoose.Types.ObjectId(), text: 'Passage 1', pageNumber: 1 },
        { _id: new mongoose.Types.ObjectId(), text: 'Passage 2', pageNumber: 2 },
      ];

      jest.spyOn(Chunk, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockChunks),
      });

      const results = await chunkService.findSimilarChunks(dummyFileId, dummyUserId, 'Query', 5);
      expect(results).toHaveLength(2);
    });

    test('returns Atlas $vectorSearch results when vector index is available', async () => {
      process.env.GEMINI_API_KEY = 'test_key';
      const queryVec = [1, 0, 0];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: queryVec } }),
      });

      const mockChunks = [
        { _id: '1', text: 'Passage 1', embedding: [1, 0, 0] },
        { _id: '2', text: 'Passage 2', embedding: [0, 1, 0] },
      ];

      jest.spyOn(Chunk, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockChunks),
      });

      const atlasResults = [{ _id: 'atlas-1', text: 'Atlas passage', pageNumber: 2 }];
      jest.spyOn(Chunk, 'aggregate').mockResolvedValue(atlasResults);

      const results = await chunkService.findSimilarChunks(dummyFileId, dummyUserId, 'target query', 1);
      expect(results).toEqual(atlasResults);
    });

    test('uses in-memory cosine similarity ranking when Atlas vectorSearch is unavailable', async () => {
      process.env.GEMINI_API_KEY = 'test_key';
      const queryVec = [1, 0, 0];
      const matchVec = [0.99, 0.01, 0];
      const nonMatchVec = [0.01, 0.99, 0];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: queryVec } }),
      });

      const mockChunks = [
        { _id: '1', text: 'Non-relevant passage', embedding: nonMatchVec },
        { _id: '2', text: 'Highly relevant passage', embedding: matchVec },
        { _id: '3', text: 'Another passage', embedding: [0, 1, 0] },
      ];

      jest.spyOn(Chunk, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockChunks),
      });

      jest.spyOn(Chunk, 'aggregate').mockRejectedValue(new Error('$vectorSearch not configured'));

      const results = await chunkService.findSimilarChunks(dummyFileId, dummyUserId, 'target query', 1);
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('2');
    });

    test('falls back to token overlap scoring when query embedding is unavailable', async () => {
      const mockChunks = [
        { _id: '1', text: 'Policy covers dental treatments and teeth procedures' },
        { _id: '2', text: 'Waiting period for pre-existing disease is 24 months' },
        { _id: '3', text: 'Room rent is capped at 1 percent of sum insured' },
      ];

      jest.spyOn(Chunk, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockChunks),
      });

      const results = await chunkService.findSimilarChunks(
        dummyFileId,
        dummyUserId,
        'What is the pre-existing disease waiting period?',
        1
      );

      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('2');
    });
  });

  describe('verifyCitations (FACTUM Anti-Hallucination Protocol)', () => {
    const candidateChunks = [
      {
        pageNumber: 4,
        text: 'Section 4.1: Pre-existing diseases will have a waiting period of 24 consecutive months.',
      },
    ];

    const candidateTables = [
      {
        pageNumber: 7,
        markdownRepresentation: '| Plan | ICU Limit |\n| Gold | No Limit |',
      },
    ];

    test('verifies citations when excerpt exists verbatim in source passages', () => {
      const citations = [
        {
          documentId: dummyFileId,
          pageNumber: 4,
          excerpt: 'waiting period of 24 consecutive months',
          clauseTitle: 'Waiting Periods',
        },
      ];

      const verified = chunkService.verifyCitations(citations, candidateChunks, candidateTables);
      expect(verified).toHaveLength(1);
      expect(verified[0].verified).toBe(true);
      expect(verified[0].pageNumber).toBe(4);
    });

    test('verifies citations when excerpt exists verbatim in source tables', () => {
      const citations = [
        {
          documentId: dummyFileId,
          pageNumber: 7,
          excerpt: 'Gold | No Limit',
          clauseTitle: 'ICU Charges',
        },
      ];

      const verified = chunkService.verifyCitations(citations, candidateChunks, candidateTables);
      expect(verified).toHaveLength(1);
      expect(verified[0].verified).toBe(true);
    });

    test('flags citation as unverified when excerpt does not exist in any source (hallucination)', () => {
      const citations = [
        {
          documentId: dummyFileId,
          pageNumber: 4,
          excerpt: 'Robotic surgeries are fully covered with zero co-pay anywhere',
          clauseTitle: 'Invented Clause',
        },
      ];

      const verified = chunkService.verifyCitations(citations, candidateChunks, candidateTables);
      expect(verified).toHaveLength(1);
      expect(verified[0].verified).toBe(false);
    });
  });

  describe('formatChunksForPrompt', () => {
    test('formats passages into prompt block with tagged reference tokens', () => {
      const chunks = [
        { pageNumber: 2, text: 'First passage text' },
        { pageNumber: 5, text: 'Second passage text' },
      ];

      const formatted = chunkService.formatChunksForPrompt(chunks);
      expect(formatted).toContain('[RELEVANT DOCUMENT PASSAGES]:');
      expect(formatted).toContain('[PASSAGE REF-1 | Page 2]:');
      expect(formatted).toContain('First passage text');
      expect(formatted).toContain('[PASSAGE REF-2 | Page 5]:');
      expect(formatted).toContain('Second passage text');
    });

    test('returns empty string for empty input', () => {
      expect(chunkService.formatChunksForPrompt([])).toBe('');
    });
  });

  describe('In-Memory Query Embedding LRU Cache & Precomputed Embeddings', () => {
    beforeEach(() => {
      chunkService.clearQueryEmbeddingCache();
    });

    test('returns cached vector on repeat query without calling fetch again', async () => {
      process.env.GEMINI_API_KEY = 'test_key';
      const dummyVec = new Array(768).fill(0.05);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embedding: { values: dummyVec },
        }),
      });

      const vec1 = await chunkService.embedQuery('Distinct LRU cache query');
      expect(vec1).toEqual(dummyVec);
      expect(fetch).toHaveBeenCalledTimes(1);

      // Repeat query with different whitespace/casing - hits LRU cache
      const vec2 = await chunkService.embedQuery('  distinct lru cache query  ');
      expect(vec2).toEqual(dummyVec);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('uses options.queryEmbedding directly without calling embedQuery in findSimilarChunks', async () => {
      const precomputedVec = [0.5, 0.5, 0.5];
      const mockChunks = [
        { _id: '1', text: 'Passage 1', embedding: [0.5, 0.5, 0.5] },
        { _id: '2', text: 'Passage 2', embedding: [0.1, 0.1, 0.1] },
      ];

      Chunk.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockChunks),
      });

      const spyEmbed = jest.spyOn(chunkService, 'embedQuery');

      const results = await chunkService.findSimilarChunks(
        new mongoose.Types.ObjectId(),
        new mongoose.Types.ObjectId(),
        'my query',
        1,
        { queryEmbedding: precomputedVec }
      );

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('Passage 1');
      expect(spyEmbed).not.toHaveBeenCalled();

      spyEmbed.mockRestore();
    });
  });
});
