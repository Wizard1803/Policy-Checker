const mongoose = require('mongoose');

// Mock dependencies before importing service
jest.mock('node-fetch');
jest.mock('../models/tables.model');

const fetch = require('node-fetch');
const Table = require('../models/tables.model');
const tableService = require('../services/table.service');

describe('Table Extraction Service (Phase 2)', () => {
  const userId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-gemini-key';
  });

  describe('isCandidateTablePage', () => {
    test('returns false for empty or non-string inputs', () => {
      expect(tableService.isCandidateTablePage(null)).toBe(false);
      expect(tableService.isCandidateTablePage(undefined)).toBe(false);
      expect(tableService.isCandidateTablePage('')).toBe(false);
      expect(tableService.isCandidateTablePage('Short text')).toBe(false);
    });

    test('returns false for pure narrative legal text', () => {
      const narrative = `
        The Insured person shall observe all reasonable steps to prevent further loss or damage.
        Upon the happening of any event which may give rise to a claim under this Policy, the Insured
        shall give immediate notice thereof to the Company within 24 hours of hospitalization.
        Failure to provide such notice may prejudice the claim settlement.
      `;
      expect(tableService.isCandidateTablePage(narrative)).toBe(false);
    });

    test('returns true for text with pipe delimiters', () => {
      const pipeText = `
        | Plan | Room Limit | ICU Limit |
        | Silver | 1% of SI | 2% of SI |
      `;
      expect(tableService.isCandidateTablePage(pipeText)).toBe(true);
    });

    test('returns true for text with tab delimiters', () => {
      const tabText = "Plan\tRoom Rent\tICU\nSilver\t1%\t2%";
      expect(tableService.isCandidateTablePage(tabText)).toBe(true);
    });

    test('returns true for policy keyword with multi-space columnar alignment', () => {
      const columnarText = `
        Schedule of Benefits
        Plan Category    Normal Room Limit    ICU Sub-limit
        Silver Tier      1% of SI per day     2% of SI per day
        Gold Tier        Single Private AC    No Sub-limit
      `;
      expect(tableService.isCandidateTablePage(columnarText)).toBe(true);
    });

    test('returns true for waiting period schedule with percentages and durations', () => {
      const waitingText = `
        Waiting Period Schedule
        Initial Waiting Period: 30 days for all illnesses.
        Specific Ailments Waiting Period: 24 months for hernia, cataract.
        Pre-Existing Disease Waiting Period: 36 months of continuous coverage.
      `;
      expect(tableService.isCandidateTablePage(waitingText)).toBe(true);
    });

    test('returns true for generic multi-column data with 4+ aligned lines', () => {
      const genericTable = `
        Alpha     Beta      Gamma
        One       Two       Three
        Four      Five      Six
        Seven     Eight     Nine
      `;
      expect(tableService.isCandidateTablePage(genericTable)).toBe(true);
    });
  });

  describe('extractJsonFromText', () => {
    test('parses clean JSON array', () => {
      const json = '[{"title": "Test Table", "headers": ["A"], "rows": [["1"]]}]';
      const result = tableService.extractJsonFromText(json);
      expect(result).toEqual([{ title: 'Test Table', headers: ['A'], rows: [['1']] }]);
    });

    test('parses JSON wrapped in markdown code fence', () => {
      const fenced = '```json\n[{"title": "Fenced", "headers": ["X"], "rows": [["Y"]]}]\n```';
      const result = tableService.extractJsonFromText(fenced);
      expect(result).toEqual([{ title: 'Fenced', headers: ['X'], rows: [['Y']] }]);
    });

    test('extracts array substring when surrounded by conversational text', () => {
      const text = 'Here are the tables extracted:\n[{"title": "Surrounded"}]\nHope this helps!';
      const result = tableService.extractJsonFromText(text);
      expect(result).toEqual([{ title: 'Surrounded' }]);
    });

    test('returns null for non-JSON text', () => {
      expect(tableService.extractJsonFromText('Not a JSON string')).toBeNull();
    });
  });

  describe('extractTablesFromPage', () => {
    test('skips extraction and returns empty array if page is not candidate', async () => {
      const narrative = 'Standard terms and conditions without any tabular structure.';
      const res = await tableService.extractTablesFromPage(fileId, userId, 1, narrative);

      expect(res).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    test('skips extraction if GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      const pipeText = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |';

      const res = await tableService.extractTablesFromPage(fileId, userId, 2, pipeText);
      expect(res).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    test('successfully extracts and persists tables from candidate text', async () => {
      const tableText = `
        Schedule of Benefits
        Plan Category    Room Limit    ICU Limit
        Silver Tier      1% of SI      2% of SI
        Gold Tier        Single AC     No Limit
      `;

      const mockGeminiJson = [
        {
          title: 'Schedule of Benefits',
          headers: ['Plan Category', 'Room Limit', 'ICU Limit'],
          rows: [
            ['Silver Tier', '1% of SI', '2% of SI'],
            ['Gold Tier', 'Single AC', 'No Limit']
          ]
        }
      ];

      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockGeminiJson) }]
              }
            }
          ]
        })
      });

      // Mock Table save
      const mockSavedTable = {
        _id: new mongoose.Types.ObjectId(),
        fileId,
        uploadedBy: userId,
        pageNumber: 3,
        tableIndex: 0,
        title: 'Schedule of Benefits',
        headers: ['Plan Category', 'Room Limit', 'ICU Limit'],
        rows: [
          ['Silver Tier', '1% of SI', '2% of SI'],
          ['Gold Tier', 'Single AC', 'No Limit']
        ],
        markdownRepresentation: '| Plan Category | Room Limit | ICU Limit |\n| --- | --- | --- |\n| Silver Tier | 1% of SI | 2% of SI |\n| Gold Tier | Single AC | No Limit |',
        extractionConfidence: 1.0,
        extractionStatus: 'success',
        save: jest.fn().mockResolvedValue(true)
      };

      Table.mockImplementation(() => mockSavedTable);

      const tables = await tableService.extractTablesFromPage(fileId, userId, 3, tableText);

      expect(fetch).toHaveBeenCalled();
      expect(mockSavedTable.save).toHaveBeenCalled();
      expect(tables.length).toBe(1);
      expect(tables[0].title).toBe('Schedule of Benefits');
      expect(tables[0].pageNumber).toBe(3);
    });

    test('error isolation: catches API error, logs warning, and returns empty array without throwing', async () => {
      const candidateText = '| A | B |\n| 1 | 2 |';

      fetch.mockRejectedValue(new Error('Network connection timeout'));

      const res = await tableService.extractTablesFromPage(fileId, userId, 5, candidateText);

      expect(res).toEqual([]); // Did not throw!
    });
  });

  describe('extractTablesFromDocument (Batched Single Call)', () => {
    test('returns empty array when candidatePages is empty or missing without calling fetch', async () => {
      const res1 = await tableService.extractTablesFromDocument(fileId, userId, []);
      const res2 = await tableService.extractTablesFromDocument(fileId, userId, null);
      expect(res1).toEqual([]);
      expect(res2).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    test('extracts multiple tables across distinct pages in a single API call', async () => {
      const candidatePages = [
        {
          pageNumber: 2,
          text: 'Schedule of Benefits\nPlan Category    Room Limit\nSilver           1% of SI'
        },
        {
          pageNumber: 5,
          text: 'Waiting Period Schedule\nCondition    Duration\nInitial      30 Days'
        }
      ];

      const mockGeminiJson = [
        {
          pageNumber: 2,
          title: 'Room Rent Limits',
          headers: ['Plan Category', 'Room Limit'],
          rows: [['Silver', '1% of SI']]
        },
        {
          pageNumber: 5,
          title: 'Waiting Period Schedule',
          headers: ['Condition', 'Duration'],
          rows: [['Initial', '30 Days']]
        }
      ];

      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockGeminiJson) }]
              }
            }
          ]
        })
      });

      const mockSavedTable2 = {
        _id: new mongoose.Types.ObjectId(),
        fileId,
        uploadedBy: userId,
        pageNumber: 2,
        tableIndex: 0,
        title: 'Room Rent Limits',
        headers: ['Plan Category', 'Room Limit'],
        rows: [['Silver', '1% of SI']],
        save: jest.fn().mockResolvedValue(true)
      };

      const mockSavedTable5 = {
        _id: new mongoose.Types.ObjectId(),
        fileId,
        uploadedBy: userId,
        pageNumber: 5,
        tableIndex: 0,
        title: 'Waiting Period Schedule',
        headers: ['Condition', 'Duration'],
        rows: [['Initial', '30 Days']],
        save: jest.fn().mockResolvedValue(true)
      };

      let tableInstCount = 0;
      Table.mockImplementation(() => {
        tableInstCount++;
        return tableInstCount === 1 ? mockSavedTable2 : mockSavedTable5;
      });

      const tables = await tableService.extractTablesFromDocument(fileId, userId, candidatePages);

      expect(fetch).toHaveBeenCalledTimes(1); // EXACTLY ONE CALL!
      expect(tables.length).toBe(2);
      expect(tables[0].pageNumber).toBe(2);
      expect(tables[1].pageNumber).toBe(5);
    });

    test('error isolation: catches API error and returns empty array without throwing', async () => {
      const candidatePages = [
        { pageNumber: 3, text: '| A | B |\n| 1 | 2 |' }
      ];

      fetch.mockRejectedValue(new Error('503 Service Unavailable'));

      const res = await tableService.extractTablesFromDocument(fileId, userId, candidatePages);
      expect(res).toEqual([]);
    });
  });

  describe('findRelevantTables', () => {
    test('returns empty array when document has no tables', async () => {
      Table.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([])
      });

      const res = await tableService.findRelevantTables(fileId, userId, 'ICU charges');
      expect(res).toEqual([]);
    });

    test('smart injection: returns all tables directly when count <= 5 without filtering', async () => {
      const mockTables = [
        { title: 'Table 1', pageNumber: 2, headers: ['A'], rows: [['1']] },
        { title: 'Table 2', pageNumber: 4, headers: ['B'], rows: [['2']] },
        { title: 'Table 3', pageNumber: 7, headers: ['C'], rows: [['3']] }
      ];

      Table.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockTables)
      });

      // Query doesn't match table words, but because count <= 5, all 3 must be returned
      const res = await tableService.findRelevantTables(fileId, userId, 'Unmatched topic');
      expect(res.length).toBe(3);
      expect(res).toEqual(mockTables);
    });

    test('ranks and returns top 5 tables based on query token overlap when count > 5', async () => {
      const mockTables = [
        { title: 'General Definitions', pageNumber: 1, headers: ['Term'], rows: [['Definition']] },
        { title: 'Room Rent & ICU Sub-limits', pageNumber: 2, headers: ['Plan', 'ICU'], rows: [['Gold', 'No Limit']] },
        { title: 'Maternity Cover', pageNumber: 3, headers: ['Plan'], rows: [['Normal']] },
        { title: 'Waiting Periods Schedule', pageNumber: 4, headers: ['Condition'], rows: [['Surgery']] },
        { title: 'Organ Donor Expenses', pageNumber: 5, headers: ['Cover'], rows: [['Limit']] },
        { title: 'Ambulance Charges', pageNumber: 6, headers: ['Type'], rows: [['Emergency']] },
        { title: 'ICU Procedure Breakdown', pageNumber: 7, headers: ['ICU Tier'], rows: [['Intensive']] }
      ];

      Table.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockTables)
      });

      const res = await tableService.findRelevantTables(fileId, userId, 'What is the ICU limit for Gold plan?');

      expect(res.length).toBe(5);
      // The two ICU-related tables should be at the top of the ranked results
      expect(res[0].title).toContain('ICU');
      expect(res[1].title).toContain('ICU');
    });

    test('returns all tables when options.allTables is true regardless of table count', async () => {
      const mockTables = [
        { title: 'T1', pageNumber: 1, headers: ['A'], rows: [['1']] },
        { title: 'T2', pageNumber: 2, headers: ['B'], rows: [['2']] },
        { title: 'T3', pageNumber: 3, headers: ['C'], rows: [['3']] },
        { title: 'T4', pageNumber: 4, headers: ['D'], rows: [['4']] },
        { title: 'T5', pageNumber: 5, headers: ['E'], rows: [['5']] },
        { title: 'T6', pageNumber: 6, headers: ['F'], rows: [['6']] },
        { title: 'T7', pageNumber: 7, headers: ['G'], rows: [['7']] },
      ];

      Table.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockTables)
      });

      const res = await tableService.findRelevantTables(fileId, userId, 'Audit query', { allTables: true });

      expect(res.length).toBe(7);
      expect(res).toEqual(mockTables);
    });
  });

  describe('formatTablesForPrompt', () => {
    test('returns empty string for empty table array', () => {
      expect(tableService.formatTablesForPrompt([])).toBe('');
      expect(tableService.formatTablesForPrompt(null)).toBe('');
    });

    test('formats array of tables with header block and Markdown representation', () => {
      const tables = [
        {
          title: 'Room Rent Limits',
          pageNumber: 6,
          markdownRepresentation: '| Plan | Rent |\n| --- | --- |\n| Gold | Single AC |'
        },
        {
          title: 'Waiting Periods',
          pageNumber: 12,
          markdownRepresentation: '| Type | Days |\n| --- | --- |\n| Initial | 30 |'
        }
      ];

      const formatted = tableService.formatTablesForPrompt(tables);

      expect(formatted).toContain('[RELEVANT STRUCTURED TABLES]:');
      expect(formatted).toContain('Table 1 (Page 6) - Room Rent Limits:');
      expect(formatted).toContain('| Plan | Rent |');
      expect(formatted).toContain('Table 2 (Page 12) - Waiting Periods:');
      expect(formatted).toContain('| Type | Days |');
    });
  });
});
