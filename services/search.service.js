const File = require('../models/files.model');
const chunkService = require('./chunk.service');
const tableService = require('./table.service');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

/**
 * Extracts a concise snippet from passage text highlighting matching query terms.
 *
 * @param {string} text
 * @param {string} query
 * @param {number} [snippetLength=240]
 * @returns {string}
 */
function extractSnippet(text, query, snippetLength = 240) {
  if (!text || typeof text !== 'string') return '';
  if (!query || typeof query !== 'string') return text.slice(0, snippetLength);

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (queryTerms.length === 0) {
    return text.length > snippetLength ? `${text.slice(0, snippetLength)}...` : text;
  }

  // Find the earliest occurrence of any query term
  let bestPos = -1;
  const lowerText = text.toLowerCase();
  for (const term of queryTerms) {
    const pos = lowerText.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) {
    return text.length > snippetLength ? `${text.slice(0, snippetLength)}...` : text;
  }

  const start = Math.max(0, bestPos - 40);
  const end = Math.min(text.length, start + snippetLength);
  let snippet = text.slice(start, end).trim();

  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;

  return snippet;
}

/**
 * Searches policy chunks and structured tables for direct clause matches.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.limit=10]
 * @returns {Promise<Object>}
 */
async function searchPolicyClauses(fileId, userId, query, options = {}) {
  const startTime = Date.now();

  if (!query || typeof query !== 'string' || !query.trim()) {
    const err = new Error('Search query is required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanQuery = query.trim();
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const fileDoc = await File.findOne({ _id: fileId, uploadedBy: userId });
  if (!fileDoc) {
    const err = new Error('File not found or unauthorized.');
    err.statusCode = 404;
    throw err;
  }

  if (fileDoc.processingState === 'uploaded' || fileDoc.processingState === 'processing') {
    const err = new Error('Document is currently being processed. Please wait until processing completes.');
    err.statusCode = 409;
    throw err;
  }

  if (fileDoc.processingState === 'failed') {
    const err = new Error(fileDoc.processingError || 'Document processing failed.');
    err.statusCode = 422;
    throw err;
  }

  // Retrieve candidate passages and structured tables
  const queryEmbedding = await chunkService.embedQuery(cleanQuery).catch(() => null);

  const [candidateChunks, candidateTables] = await Promise.all([
    chunkService.findSimilarChunks(fileId, userId, cleanQuery, limit * 2, { queryEmbedding }),
    tableService.findRelevantTables(fileId, userId, cleanQuery, { maxDirect: 15, limit: 10 }),
  ]);

  const results = [];

  // 1. Process structured tables
  if (Array.isArray(candidateTables)) {
    for (const table of candidateTables) {
      results.push({
        type: 'table',
        pageNumber: table.pageNumber || 1,
        title: table.title || 'Schedule of Benefits',
        score: 0.95,
        relevancePercent: 95,
        text: table.markdownRepresentation || '',
        snippet: `[Actuarial Table] ${table.title || 'Schedule Table'} on Page ${table.pageNumber || 1}`,
      });
    }
  }

  // 2. Process text passages
  if (Array.isArray(candidateChunks)) {
    for (const chunk of candidateChunks) {
      let score;
      if (queryEmbedding && Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
        score = chunkService.cosineSimilarity(queryEmbedding, chunk.embedding);
      } else {
        // Simple token matching density if embedding unavailable
        const terms = cleanQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        const chunkLower = (chunk.text || '').toLowerCase();
        let matches = 0;
        for (const term of terms) {
          if (chunkLower.includes(term)) matches++;
        }
        score = terms.length > 0 ? 0.6 + (matches / terms.length) * 0.35 : 0.7;
      }

      // Map raw cosine (-1 to 1) to an intuitive 50% - 99% relevance band
      const normalizedScore = Math.max(0, Math.min(1, score));
      const relevancePercent = Math.min(99, Math.max(45, Math.round(normalizedScore * 100)));

      results.push({
        type: 'passage',
        pageNumber: chunk.pageNumber || 1,
        chunkIndex: chunk.chunkIndex || 0,
        score: parseFloat(score.toFixed(4)),
        relevancePercent,
        text: chunk.text || '',
        snippet: extractSnippet(chunk.text || '', cleanQuery),
      });
    }
  }

  // Sort descending by relevance score
  results.sort((a, b) => b.score - a.score);

  const finalResults = results.slice(0, limit);
  const executionTimeMs = Date.now() - startTime;

  return {
    success: true,
    fileId: fileDoc._id,
    fileName: fileDoc.fileName,
    query: cleanQuery,
    count: finalResults.length,
    totalResults: results.length,
    executionTimeMs,
    results: finalResults,
  };
}

module.exports = {
  searchPolicyClauses,
  extractSnippet,
};
