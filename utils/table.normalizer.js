/**
 * Tabular Data Normalizer and GitHub-Flavored Markdown (GFM) Generator.
 * Converts structured 2D table arrays into standardized Markdown tables
 * with column width alignment, pipe escaping, and newline neutralization.
 */

/**
 * Escapes characters that would break GFM table cell boundaries.
 * Replaces unescaped pipes with \| and newline characters with <br>.
 *
 * @param {any} value
 * @returns {string}
 */
function escapeCellContent(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value).trim();
  if (!str) {
    return '';
  }

  return str
    .replace(/\\\|/g, '__ESCAPED_PIPE__')
    .replace(/\|/g, '\\|')
    .replace(/__ESCAPED_PIPE__/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Calculates extraction confidence score based on table density.
 * Returns 1.0 for multi-column and multi-row tables; 0.7 for sparse tables.
 *
 * @param {Array<string>} headers
 * @param {Array<Array<string>>} rows
 * @returns {number}
 */
function calculateConfidence(headers, rows) {
  const validHeaders = Array.isArray(headers) ? headers.filter((h) => Boolean(h && String(h).trim())) : [];
  const validRows = Array.isArray(rows) ? rows.filter((r) => Array.isArray(r) && r.length > 0) : [];

  if (validHeaders.length >= 2 && validRows.length >= 2) {
    return 1.0;
  }
  return 0.7;
}

/**
 * Formats headers and 2D row arrays into an aligned GFM Markdown table.
 *
 * @param {Array<string>} [headers=[]]
 * @param {Array<Array<string>>} [rows=[]]
 * @returns {string}
 */
function formatTableToMarkdown(headers = [], rows = []) {
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const safeRows = Array.isArray(rows) ? rows : [];

  let numCols = safeHeaders.length;
  for (const row of safeRows) {
    if (Array.isArray(row) && row.length > numCols) {
      numCols = row.length;
    }
  }

  if (numCols === 0) {
    return '';
  }

  // Normalize header labels
  const normalizedHeaders = [];
  for (let i = 0; i < numCols; i++) {
    const raw = safeHeaders[i];
    const escaped = escapeCellContent(raw);
    normalizedHeaders.push(escaped || `Column ${i + 1}`);
  }

  // Normalize rows to fixed column length
  const normalizedRows = safeRows.map((row) => {
    const cells = [];
    for (let i = 0; i < numCols; i++) {
      const val = Array.isArray(row) ? row[i] : '';
      cells.push(escapeCellContent(val));
    }
    return cells;
  });

  // Calculate column widths for aligned monospace rendering
  const colWidths = new Array(numCols).fill(3); // minimum 3 for '---'
  for (let i = 0; i < numCols; i++) {
    colWidths[i] = Math.max(colWidths[i], normalizedHeaders[i].length);
    for (const row of normalizedRows) {
      colWidths[i] = Math.max(colWidths[i], row[i].length);
    }
  }

  // Format header row
  const headerCells = normalizedHeaders.map((h, i) => h.padEnd(colWidths[i], ' '));
  const headerLine = `| ${headerCells.join(' | ')} |`;

  // Format separator row
  const separatorCells = colWidths.map((w) => '-'.repeat(w));
  const separatorLine = `| ${separatorCells.join(' | ')} |`;

  // Format data rows
  const rowLines = normalizedRows.map((row) => {
    const cells = row.map((cell, i) => cell.padEnd(colWidths[i], ' '));
    return `| ${cells.join(' | ')} |`;
  });

  return [headerLine, separatorLine, ...rowLines].join('\n');
}

/**
 * Validates and normalizes raw table data from extraction or API,
 * generating a clean title, sanitized headers, sanitized rows,
 * GFM markdown representation, and confidence score.
 *
 * @param {Object} rawTable
 * @returns {Object}
 */
function normalizeTableData(rawTable = {}) {
  const title = (rawTable.title && String(rawTable.title).trim()) || 'Document Table';
  const headers = Array.isArray(rawTable.headers)
    ? rawTable.headers.map((h) => escapeCellContent(h))
    : [];

  const rows = Array.isArray(rawTable.rows)
    ? rawTable.rows.map((row) => (Array.isArray(row) ? row.map((cell) => escapeCellContent(cell)) : []))
    : [];

  const markdownRepresentation = formatTableToMarkdown(headers, rows);
  const extractionConfidence = calculateConfidence(headers, rows);

  return {
    title,
    pageNumber: Number(rawTable.pageNumber) || 1,
    tableIndex: Number(rawTable.tableIndex) || 0,
    headers,
    rows,
    markdownRepresentation,
    extractionConfidence,
    extractionStatus: rawTable.extractionStatus || 'success'
  };
}

module.exports = {
  escapeCellContent,
  calculateConfidence,
  formatTableToMarkdown,
  normalizeTableData
};
