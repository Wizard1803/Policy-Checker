const geminiClient = require('./gemini.client');
const Chunk = require('../models/chunks.model');

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;
const MAX_BATCH_SIZE = 100;
const TARGET_CHUNK_WORDS = 350;
const OVERLAP_WORDS = 50;
const DEFAULT_TOP_K = 5;
const STOP_WORDS = new Set(['what', 'is', 'the', 'in', 'my', 'of', 'and', 'a', 'an', 'does', 'for', 'to', 'how', 'much', 'are', 'on', 'with', 'policy', 'check']);
const MAX_QUERY_CACHE_SIZE = 200;
const queryEmbeddingCache = new Map();

function clearQueryEmbeddingCache() {
  queryEmbeddingCache.clear();
}

/**
 * Splits text of individual pages into page-bounded chunks.
 * Invariant: Chunks never cross PDF page boundaries (LegRAG principle).
 *
 * @param {Array<{pageNumber: number, text: string}>} pages
 * @returns {Array<{pageNumber: number, chunkIndex: number, text: string, charLength: number}>}
 */
function createChunksFromPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [];
  }

  const chunks = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    const pageNumber = page.pageNumber || 1;
    const rawText = (page.text || '').trim();
    if (!rawText) continue;

    const words = rawText.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Single chunk if page text is compact
    if (words.length <= TARGET_CHUNK_WORDS + OVERLAP_WORDS) {
      chunks.push({
        pageNumber,
        chunkIndex: globalChunkIndex++,
        text: rawText,
        charLength: rawText.length,
      });
      continue;
    }

    // Sliding window chunking within page boundary
    const step = TARGET_CHUNK_WORDS - OVERLAP_WORDS;
    for (let i = 0; i < words.length; i += step) {
      const chunkWords = words.slice(i, i + TARGET_CHUNK_WORDS);
      if (chunkWords.length === 0) break;

      const chunkText = chunkWords.join(' ').trim();
      chunks.push({
        pageNumber,
        chunkIndex: globalChunkIndex++,
        text: chunkText,
        charLength: chunkText.length,
      });

      if (i + TARGET_CHUNK_WORDS >= words.length) {
        break;
      }
    }
  }

  return chunks;
}

/**
 * Computes cosine similarity between two numerical vectors.
 *
 * @param {Array<number>} vecA
 * @param {Array<number>} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);

  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Generates 768-dimensional embeddings for a batch of strings via Gemini embedding model.
 *
 * @param {Array<string>} texts
 * @returns {Promise<Array<Array<number>>|null>}
 */
async function generateEmbeddings(texts) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS;
  if (!apiKey || !Array.isArray(texts) || texts.length === 0) {
    return null;
  }

  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    try {
      const result = await geminiClient.batchEmbedContents({
        texts: batch,
        model: EMBEDDING_MODEL,
        priority: 'low',
        timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 30000,
      });

      if (!Array.isArray(result)) {
        return null;
      }

      allEmbeddings.push(...result);
    } catch (err) {
      console.warn('generateEmbeddings error:', err.message);
      return null;
    }
  }

  return allEmbeddings.length === texts.length ? allEmbeddings : null;
}

/**
 * Generates an embedding for a single query string.
 *
 * @param {string} queryText
 * @returns {Promise<Array<number>|null>}
 */
async function embedQuery(queryText) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS;
  if (!apiKey || typeof queryText !== 'string' || !queryText.trim()) {
    return null;
  }

  const cacheKey = queryText.trim().toLowerCase();
  if (queryEmbeddingCache.has(cacheKey)) {
    const cached = queryEmbeddingCache.get(cacheKey);
    queryEmbeddingCache.delete(cacheKey);
    queryEmbeddingCache.set(cacheKey, cached);
    return cached;
  }

  try {
    const vector = await geminiClient.embedContent({
      text: queryText,
      model: EMBEDDING_MODEL,
      priority: 'high',
      timeoutMs: 8000,
    });

    if (vector && Array.isArray(vector)) {
      if (queryEmbeddingCache.size >= MAX_QUERY_CACHE_SIZE) {
        const oldestKey = queryEmbeddingCache.keys().next().value;
        queryEmbeddingCache.delete(oldestKey);
      }
      queryEmbeddingCache.set(cacheKey, vector);
    }

    return vector;
  } catch (err) {
    console.warn('embedQuery error:', err.message);
    return null;
  }
}

/**
 * Indexes pages of a document into page-bounded chunks with embeddings.
 * Error isolated: failure here will not throw or break the parent ingestion pipeline.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Array<{pageNumber: number, text: string}>} pages
 * @returns {Promise<Array<Object>>}
 */
async function indexDocumentChunks(fileId, userId, pages) {
  try {
    const rawChunks = createChunksFromPages(pages);
    if (rawChunks.length === 0) return [];

    const texts = rawChunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);

    const chunkDocs = [];
    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i];
      // Fallback: 768 zero-vector if offline/mock or API unavailable
      const embedding = embeddings && embeddings[i]
        ? embeddings[i]
        : new Array(EMBEDDING_DIMENSIONS).fill(0);

      chunkDocs.push({
        fileId,
        uploadedBy: userId,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        charLength: chunk.charLength,
        embedding,
      });
    }

    if (chunkDocs.length > 0) {
      return await Chunk.insertMany(chunkDocs);
    }
    return [];
  } catch (err) {
    console.warn(`indexDocumentChunks error for file ${fileId}:`, err.message);
    return [];
  }
}

/**
 * Retrieves top-K semantically relevant passages using Dual-Mode Retrieval:
 * 1. Attempts Atlas $vectorSearch aggregation stage.
 * 2. Falls back to in-memory cosine similarity across document chunks.
 * 3. Falls back to token-overlap scoring if embeddings are unpopulated.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<Object>>}
 */
async function findSimilarChunks(fileId, userId, query, limit = DEFAULT_TOP_K, options = {}) {
  try {
    const chunks = await Chunk.find({ fileId, uploadedBy: userId }).lean();
    if (!chunks || chunks.length === 0) return [];

    if (chunks.length <= limit) {
      return chunks;
    }

    const queryEmbedding = (options && options.queryEmbedding) || await embedQuery(query);

    // Vector Mode (Atlas or In-Memory Cosine Fallback)
    if (queryEmbedding && Array.isArray(queryEmbedding)) {
      try {
        if (typeof Chunk.aggregate === 'function') {
          const atlasResults = await Chunk.aggregate([
            {
              $vectorSearch: {
                index: 'vector_index',
                path: 'embedding',
                queryVector: queryEmbedding,
                numCandidates: limit * 10,
                limit,
                filter: { uploadedBy: userId, fileId },
              },
            },
          ]);
          if (Array.isArray(atlasResults) && atlasResults.length > 0) {
            return atlasResults;
          }
        }
      } catch (_atlasErr) {
        // Fall through to in-memory cosine calculation
      }

      // In-Memory Cosine Fallback (takes < 3ms for 150 chunks in V8)
      const scored = chunks.map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.chunk);
    }

    // Token-overlap fallback (offline / missing API key)
    const tokens = (query || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    if (tokens.length === 0) {
      return chunks.slice(0, limit);
    }

    const tokenScored = chunks.map((chunk) => {
      const textLower = (chunk.text || '').toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (textLower.includes(t)) score++;
      }
      return { chunk, score };
    });

    tokenScored.sort((a, b) => b.score - a.score);
    return tokenScored.slice(0, limit).map((s) => s.chunk);
  } catch (err) {
    console.warn(`findSimilarChunks error for file ${fileId}:`, err.message);
    return [];
  }
}

/**
 * FACTUM Citation Verification:
 * Validates that cited excerpt strings exist verbatim as substrings
 * inside referenced source chunks or table markdowns.
 *
 * @param {Array<Object>} citations
 * @param {Array<Object>} candidateChunks
 * @param {Array<Object>} candidateTables
 * @returns {Array<Object>}
 */
function verifyCitations(citations, candidateChunks = [], candidateTables = []) {
  if (!Array.isArray(citations) || citations.length === 0) {
    return [];
  }

  const normalize = (str) =>
    (str || '')
      .toLowerCase()
      .replace(/["'`“”‘’]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  return citations.map((citation) => {
    const excerpt = normalize(citation.excerpt);
    if (!excerpt || excerpt.length < 5) {
      return { ...citation, verified: false };
    }

    // Check against passages
    const matchedChunk = candidateChunks.find((chunk) => {
      const chunkNorm = normalize(chunk.text);
      return chunkNorm.includes(excerpt);
    });

    if (matchedChunk) {
      return {
        ...citation,
        pageNumber: citation.pageNumber || matchedChunk.pageNumber,
        verified: true,
      };
    }

    // Check against tables
    const matchedTable = candidateTables.find((table) => {
      const tableNorm = normalize(table.markdownRepresentation);
      return tableNorm.includes(excerpt);
    });

    if (matchedTable) {
      return {
        ...citation,
        pageNumber: citation.pageNumber || matchedTable.pageNumber,
        verified: true,
      };
    }

    return { ...citation, verified: false };
  });
}

/**
 * Formats passages for context injection in prompts.
 *
 * @param {Array<Object>} chunks
 * @returns {string}
 */
function formatChunksForPrompt(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return '';
  }

  const passages = chunks.map((c, idx) => {
    const refTag = `[PASSAGE REF-${idx + 1} | Page ${c.pageNumber}]`;
    return `${refTag}:\n"""\n${c.text}\n"""`;
  });

  return `[RELEVANT DOCUMENT PASSAGES]:\n${passages.join('\n\n')}`;
}

module.exports = {
  createChunksFromPages,
  cosineSimilarity,
  generateEmbeddings,
  embedQuery,
  indexDocumentChunks,
  findSimilarChunks,
  verifyCitations,
  formatChunksForPrompt,
  clearQueryEmbeddingCache,
  EMBEDDING_DIMENSIONS,
};
