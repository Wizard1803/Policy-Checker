const {
  escapeCellContent,
  calculateConfidence,
  formatTableToMarkdown,
  normalizeTableData
} = require('../utils/table.normalizer');

const {
  roomRentTable,
  waitingPeriodTable,
  copayTable,
  sparseTable,
  malformedTable
} = require('./fixtures/table-fixtures');

describe('Tabular Data Normalizer (Phase 0)', () => {
  describe('escapeCellContent', () => {
    test('returns empty string for null, undefined, and whitespace', () => {
      expect(escapeCellContent(null)).toBe('');
      expect(escapeCellContent(undefined)).toBe('');
      expect(escapeCellContent('   ')).toBe('');
    });

    test('escapes unescaped pipe characters with a backslash', () => {
      expect(escapeCellContent('Plan A | Plan B')).toBe('Plan A \\| Plan B');
    });

    test('does not double escape already escaped pipes', () => {
      expect(escapeCellContent('Plan A \\| Plan B')).toBe('Plan A \\| Plan B');
    });

    test('replaces newline characters with <br> tags', () => {
      expect(escapeCellContent('Line 1\nLine 2')).toBe('Line 1<br>Line 2');
      expect(escapeCellContent('Line 1\r\nLine 2')).toBe('Line 1<br>Line 2');
    });

    test('trims surrounding whitespace while preserving internal content', () => {
      expect(escapeCellContent('  10% Copay  ')).toBe('10% Copay');
    });
  });

  describe('calculateConfidence', () => {
    test('returns 1.0 when headers >= 2 and rows >= 2', () => {
      const headers = ['Col 1', 'Col 2'];
      const rows = [['A', 'B'], ['C', 'D']];
      expect(calculateConfidence(headers, rows)).toBe(1.0);
    });

    test('returns 0.7 for single column tables', () => {
      const headers = ['Single Header'];
      const rows = [['Row 1'], ['Row 2']];
      expect(calculateConfidence(headers, rows)).toBe(0.7);
    });

    test('returns 0.7 for single row tables', () => {
      const headers = ['Col 1', 'Col 2'];
      const rows = [['Only Row A', 'Only Row B']];
      expect(calculateConfidence(headers, rows)).toBe(0.7);
    });

    test('returns 0.7 when headers or rows are empty or invalid', () => {
      expect(calculateConfidence([], [])).toBe(0.7);
      expect(calculateConfidence(null, null)).toBe(0.7);
    });
  });

  describe('formatTableToMarkdown', () => {
    test('formats standard insurance room rent table with proper GFM structure', () => {
      const md = formatTableToMarkdown(roomRentTable.headers, roomRentTable.rows);

      expect(typeof md).toBe('string');
      const lines = md.split('\n');
      expect(lines.length).toBe(5); // 1 header + 1 separator + 3 data rows

      // Check header line
      expect(lines[0]).toContain('Plan Category');
      expect(lines[0]).toContain('Normal Room Rent Limit');
      expect(lines[0]).toContain('ICU Charges Limit');

      // Check separator line
      expect(lines[1]).toMatch(/^\|\s*---+\s*\|\s*---+\s*\|\s*---+\s*\|$/);

      // Check data rows
      expect(lines[2]).toContain('Silver');
      expect(lines[2]).toContain('1% of Sum Insured per day');
      expect(lines[3]).toContain('Gold');
      expect(lines[4]).toContain('Platinum');
    });

    test('formats waiting period table correctly', () => {
      const md = formatTableToMarkdown(waitingPeriodTable.headers, waitingPeriodTable.rows);
      const lines = md.split('\n');

      expect(lines.length).toBe(5);
      expect(lines[0]).toContain('Coverage Type');
      expect(lines[2]).toContain('Initial Waiting Period');
      expect(lines[3]).toContain('Specific Illnesses');
    });

    test('formats copay table correctly', () => {
      const md = formatTableToMarkdown(copayTable.headers, copayTable.rows);
      expect(md).toContain('Insured Age Band');
      expect(md).toContain('Above 70 Years');
    });

    test('handles sparse single-column table', () => {
      const md = formatTableToMarkdown(sparseTable.headers, sparseTable.rows);
      const lines = md.split('\n');

      expect(lines.length).toBe(4); // 1 header + 1 separator + 2 data rows
      expect(lines[0]).toContain('Procedure Category');
      expect(lines[2]).toContain('Chemotherapy and Radiotherapy');
    });

    test('handles malformed table with ragged rows, unescaped pipes, newlines, and nulls', () => {
      const md = formatTableToMarkdown(malformedTable.headers, malformedTable.rows);
      const lines = md.split('\n');

      expect(lines.length).toBe(5);
      // Ensure all lines have matching column count (4 pipes per line for 3 columns)
      for (const line of lines) {
        const pipeMatches = line.match(/(?<!\\)\|/g);
        expect(pipeMatches.length).toBe(4);
      }

      // Check that newline was sanitized to <br>
      expect(md).toContain('Col B<br>With Newline');
      // Check that unescaped pipe was escaped
      expect(md).toContain('Col A \\| Unescaped');
    });

    test('auto-generates column headers when headers array is empty but rows exist', () => {
      const rows = [['Val 1', 'Val 2']];
      const md = formatTableToMarkdown([], rows);

      expect(md).toContain('Column 1');
      expect(md).toContain('Column 2');
      expect(md).toContain('Val 1');
      expect(md).toContain('Val 2');
    });

    test('returns empty string when both headers and rows are empty', () => {
      expect(formatTableToMarkdown([], [])).toBe('');
      expect(formatTableToMarkdown(null, null)).toBe('');
    });
  });

  describe('normalizeTableData', () => {
    test('normalizes table object and produces complete document representation', () => {
      const normalized = normalizeTableData(roomRentTable);

      expect(normalized.title).toBe('Room Rent and ICU Sub-Limits');
      expect(normalized.pageNumber).toBe(6);
      expect(normalized.tableIndex).toBe(0);
      expect(normalized.headers).toEqual(roomRentTable.headers);
      expect(normalized.rows).toEqual(roomRentTable.rows);
      expect(normalized.extractionConfidence).toBe(1.0);
      expect(normalized.extractionStatus).toBe('success');
      expect(normalized.markdownRepresentation).toContain('| Plan Category');
    });

    test('applies defaults when given incomplete raw table data', () => {
      const normalized = normalizeTableData({});

      expect(normalized.title).toBe('Document Table');
      expect(normalized.pageNumber).toBe(1);
      expect(normalized.tableIndex).toBe(0);
      expect(normalized.headers).toEqual([]);
      expect(normalized.rows).toEqual([]);
      expect(normalized.markdownRepresentation).toBe('');
      expect(normalized.extractionConfidence).toBe(0.7);
      expect(normalized.extractionStatus).toBe('success');
    });
  });
});
