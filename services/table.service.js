const Table = require('../models/tables.model');
const tableNormalizer = require('../utils/table.normalizer');
const geminiClient = require('./gemini.client');

const POLICY_TABULAR_KEYWORDS = /(schedule of benefits|waiting period|room rent|icu limit|sub-limit|deductible|co-payment|copayment|day care treatment|scale of compensation|coverage limit|sum insured|tier [1-9]|network hospital)/i;
const STOP_WORDS = new Set(['what', 'is', 'the', 'in', 'my', 'of', 'and', 'a', 'an', 'does', 'for', 'to', 'how', 'much', 'are', 'on', 'with', 'policy', 'check']);
const TABLE_EXTRACTION_MODEL = process.env.GEMINI_TABLE_MODEL || 'gemini-flash-lite-latest';
const TABLE_FALLBACK_MODELS = [TABLE_EXTRACTION_MODEL, 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];

/**
 * Heuristically evaluates whether a page text likely contains tabular content.
 * Avoids unnecessary LLM API calls on narrative text pages.
 *
 * @param {string} pageText
 * @returns {boolean}
 */
function isCandidateTablePage(pageText) {
  if (!pageText || typeof pageText !== 'string' || pageText.trim().length < 20) {
    return false;
  }

  // Explicit pipe delimiter heuristic (standard markdown or ASCII tables)
  const pipeCount = (pageText.match(/\|/g) || []).length;
  if (pipeCount >= 3) {
    return true;
  }

  // Explicit tab delimiter heuristic
  const tabCount = (pageText.match(/\t/g) || []).length;
  if (tabCount >= 3) {
    return true;
  }

  const lines = pageText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Columnar multi-space gaps heuristic (e.g. "Silver    1%    2%")
  let multiColumnLines = 0;
  let numericLines = 0;

  const numericPattern = /(?:\d+%|\b(?:INR|Rs\.?|₹|\$)\s*\d+|\b\d+\s*(?:days|months|years)\b)/i;

  for (const line of lines) {
    const gaps = line.match(/\s{2,}/g) || [];
    if (gaps.length >= 2 || (gaps.length >= 1 && numericPattern.test(line))) {
      multiColumnLines++;
    }
    if (numericPattern.test(line)) {
      numericLines++;
    }
  }

  // Generic columnar table with 3+ aligned rows
  if (multiColumnLines >= 3) {
    return true;
  }

  // Policy domain keyword table with columnar or metric density
  const hasKeyword = POLICY_TABULAR_KEYWORDS.test(pageText);
  if (hasKeyword && (multiColumnLines >= 1 || numericLines >= 2)) {
    return true;
  }

  return false;
}

/**
 * Extracts and parses JSON array from model output, handling markdown code fences.
 *
 * @param {string} rawText
 * @returns {Array<Object>|null}
 */
function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const clean = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const startIdx = clean.search(/\[/);
    const endIdx = clean.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      try {
        const sliced = clean.slice(startIdx, endIdx + 1);
        const parsed = JSON.parse(sliced);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extracts structured tables from a single page using Gemini Flash with strict error isolation.
 * If extraction fails or hits rate limits, logs a warning and returns an empty array,
 * ensuring document ingestion never fails because of table extraction errors.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {number} pageNumber
 * @param {string} pageText
 * @returns {Promise<Array<Object>>}
 */
async function extractTablesFromPage(fileId, userId, pageNumber, pageText, options = {}) {
  if (!isCandidateTablePage(pageText)) {
    return [];
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS;
  if (!apiKey) {
    console.warn(`extractTablesFromPage: GEMINI_API_KEY not set. Skipping table extraction on page ${pageNumber}.`);
    return [];
  }

  const prompt = `You are an expert tabular data extraction engine.
Analyze the following single-page text from an insurance policy document.
Extract ALL structured tables into a JSON array of table objects.

Output format requirement:
[
  {
    "title": "Descriptive Table Title",
    "headers": ["Col 1", "Col 2", ...],
    "rows": [
      ["Val 1", "Val 2", ...]
    ]
  }
]

Rules:
1. Preserve exact cell values (percentages, currency amounts, durations, conditions).
2. Do not invent columns or rows.
3. If no clear tabular data exists on this page, return [].
4. Output ONLY valid raw JSON without markdown or conversational text.

Page Text (Page ${pageNumber}):
"""
${pageText}
"""`;

  try {
    const apiResult = await geminiClient.generateContent({
      prompt,
      candidateModels: TABLE_FALLBACK_MODELS,
      priority: options.priority || 'low',
      responseMimeType: 'application/json',
      timeoutMs: 25000,
    });

    const textContent = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
    const extractedList = extractJsonFromText(textContent);

    if (!Array.isArray(extractedList) || extractedList.length === 0) {
      return [];
    }

    const savedTables = [];
    for (let i = 0; i < extractedList.length; i++) {
      const raw = extractedList[i];
      const normalized = tableNormalizer.normalizeTableData({
        ...raw,
        pageNumber,
        tableIndex: i
      });

      if (normalized.headers.length === 0 && normalized.rows.length === 0) {
        continue;
      }

      const tableDoc = new Table({
        fileId,
        uploadedBy: userId,
        pageNumber,
        tableIndex: i,
        title: normalized.title,
        headers: normalized.headers,
        rows: normalized.rows,
        markdownRepresentation: normalized.markdownRepresentation,
        extractionConfidence: normalized.extractionConfidence,
        extractionStatus: 'success'
      });

      await tableDoc.save();
      savedTables.push(tableDoc);
    }

    return savedTables;
  } catch (err) {
    // Error isolation: log warning and return empty array without failing the parent pipeline
    console.warn(`extractTablesFromPage warning (Page ${pageNumber}, File ${fileId}):`, err.message);
    return [];
  }
}

/**
 * Extracts structured tables from all candidate pages of a document in a single batched API call.
 * Uses dedicated Flash-Lite model (gemini-flash-lite-latest) to guarantee zero congestion,
 * and processes all candidate pages in exactly 1 call to strictly respect 5 RPM limits.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Array<{pageNumber: number, text: string}>} candidatePages
 * @param {Object} [options]
 * @returns {Promise<Array<Object>>}
 */
async function extractTablesFromDocument(fileId, userId, candidatePages, options = {}) {
  if (!Array.isArray(candidatePages) || candidatePages.length === 0) {
    return [];
  }

  const validPages = candidatePages.filter(
    (p) => p && typeof p.text === 'string' && isCandidateTablePage(p.text)
  );
  if (validPages.length === 0) {
    return [];
  }

  // Process up to 10 candidate pages across the document in a single batched call
  const maxPages = Math.max(1, Number(process.env.MAX_TABLE_PAGES) || 10);
  const pagesToProcess = validPages.slice(0, maxPages);

  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS;
  if (!apiKey) {
    console.warn(`extractTablesFromDocument: GEMINI_API_KEY not set. Skipping table extraction.`);
    return [];
  }

  const pageSections = pagesToProcess
    .map((p) => `=== [BEGIN SECTION: PAGE ${p.pageNumber}] ===\n${p.text.trim()}\n=== [END SECTION: PAGE ${p.pageNumber}] ===`)
    .join('\n\n');

  const prompt = `You are an expert tabular data extraction engine.
Analyze the following insurance policy document sections across multiple pages.
Extract ALL structured tables into a single JSON array of table objects.

Each table object MUST include the exact pageNumber where that table was found:
[
  {
    "pageNumber": 2,
    "title": "Descriptive Table Title",
    "headers": ["Col 1", "Col 2"],
    "rows": [
      ["Val 1", "Val 2"]
    ]
  }
]

Rules:
1. Preserve exact cell values (percentages, currency amounts, durations, conditions).
2. Do not invent columns or rows.
3. If no clear tabular data exists in a section, do not include an empty table for that page.
4. Output ONLY valid raw JSON without markdown or conversational text.

Document Sections:
${pageSections}`;

  try {
    const apiResult = await geminiClient.generateContent({
      prompt,
      candidateModels: TABLE_FALLBACK_MODELS,
      priority: options.priority || 'low',
      responseMimeType: 'application/json',
      timeoutMs: 25000,
    });

    const textContent = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
    const extractedList = extractJsonFromText(textContent);

    if (!Array.isArray(extractedList) || extractedList.length === 0) {
      return [];
    }

    const savedTables = [];
    const pageTableIndices = new Map();

    for (const raw of extractedList) {
      if (!raw || typeof raw !== 'object') continue;

      const pageNumber = Number(raw.pageNumber) || pagesToProcess[0]?.pageNumber || 1;
      const currentIndex = pageTableIndices.get(pageNumber) || 0;
      pageTableIndices.set(pageNumber, currentIndex + 1);

      const normalized = tableNormalizer.normalizeTableData({
        ...raw,
        pageNumber,
        tableIndex: currentIndex,
      });

      if (normalized.headers.length === 0 && normalized.rows.length === 0) {
        continue;
      }

      const tableDoc = new Table({
        fileId,
        uploadedBy: userId,
        pageNumber,
        tableIndex: currentIndex,
        title: normalized.title,
        headers: normalized.headers,
        rows: normalized.rows,
        markdownRepresentation: normalized.markdownRepresentation,
        extractionConfidence: normalized.extractionConfidence,
        extractionStatus: 'success',
      });

      await tableDoc.save();
      savedTables.push(tableDoc);
    }

    return savedTables;
  } catch (err) {
    console.warn(`extractTablesFromDocument warning (File ${fileId}):`, err.message);
    return [];
  }
}

/**
 * Retrieves relevant tables for a user query.
 * Smart injection: if total tables <= 5, returns all tables directly.
 * If total tables > 5, scores tables by query token overlap and returns top 5.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} query
 * @param {Object} [options]
 * @param {boolean} [options.allTables=false]
 * @param {number} [options.maxDirect=5]
 * @param {number} [options.limit=5]
 * @returns {Promise<Array<Object>>}
 */
async function findRelevantTables(fileId, userId, query, options = {}) {
  const opts = typeof options === 'number' ? { limit: options } : (options || {});
  const tables = await Table.find({ fileId, uploadedBy: userId }).sort({ pageNumber: 1, tableIndex: 1 });

  if (!tables || tables.length === 0) {
    return [];
  }

  // If requested to include all tables (e.g. Audit Report) or total tables <= maxDirect threshold
  const maxDirect = opts.allTables ? Infinity : (opts.maxDirect || 5);
  if (opts.allTables || tables.length <= maxDirect) {
    return tables;
  }

  const limit = opts.limit || 5;

  if (!query || typeof query !== 'string') {
    return tables.slice(0, limit);
  }

  // Tokenize query into keywords
  const tokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  if (tokens.length === 0) {
    return tables.slice(0, limit);
  }

  const scored = tables.map((tbl) => {
    let score = 0;
    const titleLower = (tbl.title || '').toLowerCase();
    const headersLower = (tbl.headers || []).join(' ').toLowerCase();
    const rowsLower = (tbl.rows || []).flat().join(' ').toLowerCase();

    for (const token of tokens) {
      if (titleLower.includes(token)) score += 3;
      if (headersLower.includes(token)) score += 2;
      if (rowsLower.includes(token)) score += 1;
    }

    return { table: tbl, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.table);
}

/**
 * Formats an array of tables into Markdown blocks for prompt context injection.
 *
 * @param {Array<Object>} tables
 * @returns {string}
 */
function formatTablesForPrompt(tables) {
  if (!Array.isArray(tables) || tables.length === 0) {
    return '';
  }

  const formatted = tables.map((t, idx) => {
    const title = t.title || 'Table';
    const page = t.pageNumber ? ` (Page ${t.pageNumber})` : '';
    return `Table ${idx + 1}${page} - ${title}:\n${t.markdownRepresentation}`;
  });

  return `[RELEVANT STRUCTURED TABLES]:\n${formatted.join('\n\n')}`;
}

module.exports = {
  isCandidateTablePage,
  extractJsonFromText,
  extractTablesFromPage,
  extractTablesFromDocument,
  findRelevantTables,
  formatTablesForPrompt
};
