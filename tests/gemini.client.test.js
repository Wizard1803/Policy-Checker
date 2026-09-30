const geminiClient = require('../services/gemini.client');
const fetch = require('node-fetch');

jest.mock('node-fetch');

describe('Centralized Gemini Client & Dispatcher (Group 1 Architecture)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    geminiClient.resetPool();
  });

  afterAll(() => {
    process.env = originalEnv;
    geminiClient.resetPool();
  });

  describe('API Key Parsing & Round-Robin Rotation', () => {
    test('parses comma-separated keys from GEMINI_API_KEY', () => {
      process.env.GEMINI_API_KEY = 'keyA, keyB , keyC';
      const keys = geminiClient.parseApiKeys();
      expect(keys).toEqual(['keyA', 'keyB', 'keyC']);
    });

    test('parses single key correctly', () => {
      process.env.GEMINI_API_KEY = 'singleKey';
      const keys = geminiClient.parseApiKeys();
      expect(keys).toEqual(['singleKey']);
    });

    test('rotates healthy keys via round-robin', () => {
      process.env.GEMINI_API_KEY = 'key1,key2,key3';
      geminiClient.initPool();

      const k1 = geminiClient.getNextHealthyKey().keyObj;
      const k2 = geminiClient.getNextHealthyKey().keyObj;
      const k3 = geminiClient.getNextHealthyKey().keyObj;
      const k4 = geminiClient.getNextHealthyKey().keyObj;

      expect(k1.key).toBe('key1');
      expect(k2.key).toBe('key2');
      expect(k3.key).toBe('key3');
      expect(k4.key).toBe('key1');
    });
  });

  describe('429 Quarantine & Instant Failover', () => {
    test('quarantines Key 1 on 429 and immediately retries with Key 2 successfully', async () => {
      process.env.GEMINI_API_KEY = 'keyA,keyB';
      geminiClient.initPool();

      fetch
        .mockResolvedValueOnce({
          status: 429,
          ok: false,
          headers: { get: () => '60' },
          text: async () => JSON.stringify({ error: { message: 'Quota exceeded for keyA' } }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Successful answer from keyB' }] } }],
          }),
        });

      const result = await geminiClient.generateContent({
        prompt: 'What is the copay?',
        priority: 'high',
      });

      expect(result.candidates[0].content.parts[0].text).toBe('Successful answer from keyB');
      expect(fetch).toHaveBeenCalledTimes(2);

      const status = geminiClient.getKeyPoolStatus();
      expect(status.quarantinedKeys).toBe(1);
      expect(status.activeKeys).toBe(1);
    });

    test('throws 429 with actionable wait message when all keys are quarantined', async () => {
      process.env.GEMINI_API_KEY = 'exhaustedKey1,exhaustedKey2';
      geminiClient.initPool();

      fetch
        .mockResolvedValueOnce({
          status: 429,
          ok: false,
          headers: { get: () => '45' },
          text: async () => JSON.stringify({ error: { message: 'Rate limit' } }),
        })
        .mockResolvedValueOnce({
          status: 429,
          ok: false,
          headers: { get: () => '45' },
          text: async () => JSON.stringify({ error: { message: 'Rate limit' } }),
        });

      await expect(
        geminiClient.generateContent({ prompt: 'Test all exhausted', priority: 'high' })
      ).rejects.toMatchObject({
        statusCode: 429,
        code: 'ALL_KEYS_QUOTA_EXHAUSTED',
      });
    });
  });

  describe('503 Model Cascade', () => {
    test('cascades to next candidate model on HTTP 503 model overload', async () => {
      process.env.GEMINI_API_KEY = 'singleKey';
      geminiClient.initPool();

      fetch
        .mockResolvedValueOnce({
          status: 503,
          ok: false,
          headers: { get: () => null },
          text: async () => 'Model overloaded',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Answer from fallback model' }] } }],
          }),
        });

      const result = await geminiClient.generateContent({
        prompt: 'Check waiting period',
        candidateModels: ['gemini-flash-latest', 'gemini-3.7-flash'],
        priority: 'high',
      });

      expect(result.candidates[0].content.parts[0].text).toBe('Answer from fallback model');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0][0]).toContain('gemini-flash-latest');
      expect(fetch.mock.calls[1][0]).toContain('gemini-3.7-flash');
    });
  });

  describe('Dual-Priority Queue Dispatching', () => {
    test('high priority requests jump ahead of low priority requests in the queue', async () => {
      process.env.GEMINI_API_KEY = 'testKey';
      geminiClient.initPool();

      const executionOrder = [];

      fetch.mockImplementation(async (_url, opts) => {
        const bodyText = typeof opts?.body === 'string' ? opts.body : '';
        if (bodyText.includes('promptA')) executionOrder.push('lowTask');
        if (bodyText.includes('promptB')) executionOrder.push('highTask');
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        };
      });

      // Launch a low-priority task and immediately enqueue a second low and a high
      const pLow1 = geminiClient.generateContent({ prompt: 'promptA', priority: 'low' });
      const pLow2 = geminiClient.generateContent({ prompt: 'promptA', priority: 'low' });
      const pHigh = geminiClient.generateContent({ prompt: 'promptB', priority: 'high' });

      await Promise.all([pLow1, pLow2, pHigh]);

      // First task executes immediately, then pHigh must execute BEFORE pLow2
      expect(executionOrder[0]).toBe('lowTask');
      expect(executionOrder[1]).toBe('highTask');
      expect(executionOrder[2]).toBe('lowTask');
    });
  });

  describe('Vector Embeddings Dispatching', () => {
    test('batchEmbedContents delegates through queue and parses embeddings', async () => {
      process.env.GEMINI_API_KEY = 'testKey';
      geminiClient.initPool();

      fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
        }),
      });

      const vectors = await geminiClient.batchEmbedContents({
        texts: ['passage one', 'passage two'],
        priority: 'low',
      });

      expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('embedContent extracts single query vector', async () => {
      process.env.GEMINI_API_KEY = 'testKey';
      geminiClient.initPool();

      fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          embedding: { values: [0.5, 0.6] },
        }),
      });

      const vector = await geminiClient.embedContent({
        text: 'test query',
        priority: 'high',
      });

      expect(vector).toEqual([0.5, 0.6]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
