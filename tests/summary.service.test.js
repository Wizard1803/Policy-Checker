const mongoose = require('mongoose');
const summaryService = require('../services/summary.service');
const File = require('../models/files.model');
const chunkService = require('../services/chunk.service');
const tableService = require('../services/table.service');
const fetch = require('node-fetch');

jest.mock('node-fetch');
jest.mock('../services/chunk.service');
jest.mock('../services/table.service');

describe('Summary Service - Actuarial Summary & Audit Report (Feature E1)', () => {
  const userId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test_key';
    jest.spyOn(File, 'findByIdAndUpdate').mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe('parseSummaryResponse', () => {
    const mockFileDoc = {
      _id: fileId,
      fileName: 'HDFC_ERGO_OptimaSecure.pdf',
    };

    test('extracts structured parameters from JSON block correctly', () => {
      const jsonPayload = `\`\`\`json
{
  "parameters": {
    "waitingPeriodPED": "36 months",
    "waitingPeriodSpecific": "24 months",
    "waitingPeriodInitial": "30 days",
    "roomRentLimit": "Single Private AC Room",
    "icuLimit": "No sub-limit",
    "copay": "Nil",
    "preHospitalization": "60 days",
    "postHospitalization": "180 days",
    "topExclusions": ["Maternity", "Cosmetic surgery"],
    "restorationBenefit": "100% Secure benefit available"
  },
  "executiveSummary": "Comprehensive health policy with zero copay and no room rent sub-limits.",
  "reportMarkdown": "### Detailed Actuarial Findings\\nRoom rent has no capping."
}
\`\`\``;

      const result = summaryService.parseSummaryResponse(jsonPayload, mockFileDoc);
      expect(result.parameters.waitingPeriodPED).toBe('36 months');
      expect(result.parameters.roomRentLimit).toBe('Single Private AC Room');
      expect(result.parameters.copay).toBe('Nil');
      expect(result.parameters.preHospitalization).toBe('60 days');
      expect(result.parameters.postHospitalization).toBe('180 days');
      expect(result.parameters.topExclusions).toContain('Maternity');
      expect(result.executiveSummary).toContain('zero copay');
    });

    test('falls back to regex parser when output is plain text', () => {
      const plainText = `
Actuarial Review for Policy:
Pre-existing disease (PED): 48 months waiting period applies.
Room rent limit: 1% of Sum Insured daily maximum.
Co-pay: 20% mandatory for age above 60.
Pre-hospitalization: 30 days covered.
Post-hospitalization: 60 days covered.
`;

      const result = summaryService.parseSummaryResponse(plainText, mockFileDoc);
      expect(result.parameters.waitingPeriodPED).toContain('48 months');
      expect(result.parameters.roomRentLimit).toContain('1% of Sum Insured');
      expect(result.parameters.copay).toContain('20% mandatory');
      expect(result.parameters.preHospitalization).toContain('30 days');
      expect(result.parameters.postHospitalization).toContain('60 days');
      expect(result.executiveSummary).toContain(mockFileDoc.fileName);
    });
  });

  describe('formatDownloadableMarkdown', () => {
    test('formats valid markdown with tables and metadata', () => {
      const summaryData = {
        parameters: {
          waitingPeriodPED: '36 months',
          waitingPeriodSpecific: '24 months',
          waitingPeriodInitial: '30 days',
          roomRentLimit: 'Single Private Room',
          icuLimit: 'No sub-limit',
          copay: 'Nil',
          preHospitalization: '60 days',
          postHospitalization: '180 days',
          topExclusions: ['Cosmetic', 'Experimental'],
          restorationBenefit: '100% Reload',
        },
        executiveSummary: 'Premier health policy.',
        reportMarkdown: 'Detailed findings and clauses.',
        citations: [
          {
            pageNumber: 4,
            excerpt: 'Single Private A/C room allowed',
            verified: true,
          },
        ],
      };

      const fileDoc = {
        _id: fileId,
        fileName: 'Care_Advantage.pdf',
        pageCount: 32,
      };

      const md = summaryService.formatDownloadableMarkdown(summaryData, fileDoc);
      expect(md).toContain('# Actuarial Audit Report: Care_Advantage.pdf');
      expect(md).toContain('| **Room Rent Cap** | Single Private Room |');
      expect(md).toContain('| **Pre-Existing Diseases (PED)** | 36 months |');
      expect(md).toContain('- Cosmetic');
      expect(md).toContain('[Verified] **Page 4**');
    });
  });

  describe('generatePolicySummary', () => {
    test('throws 404 if file is not found or belongs to another user', async () => {
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      await expect(
        summaryService.generatePolicySummary(fileId, userId)
      ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('not found') });
    });

    test('throws 409 if document is in processing state', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'processing',
      };
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFile),
      });

      await expect(
        summaryService.generatePolicySummary(fileId, userId)
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('currently being processed') });
    });

    test('throws 422 if document failed processing', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'failed',
        processingError: 'Corrupt PDF header.',
      };
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFile),
      });

      await expect(
        summaryService.generatePolicySummary(fileId, userId)
      ).rejects.toMatchObject({ statusCode: 422, message: 'Corrupt PDF header.' });
    });

    test('throws 500 if GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;

      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'ready',
        fileName: 'Policy.pdf',
        extractedText: 'Sample policy text.',
      };
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFile),
      });

      chunkService.findSimilarChunks.mockResolvedValue([]);
      tableService.findRelevantTables.mockResolvedValue([]);

      await expect(
        summaryService.generatePolicySummary(fileId, userId)
      ).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('GEMINI_API_KEY') });
    });

    test('successfully generates summary with structured parameters and verified citations', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'ready',
        fileName: 'Star_Comprehensive.pdf',
        pageCount: 22,
        extractedText: 'Policy text on pre-existing diseases and room rent.',
      };
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFile),
      });

      const mockChunks = [
        { text: 'Waiting period for PED is 36 months.', pageNumber: 5 },
      ];
      const mockTables = [
        { title: 'Room Rent Limits', markdownRepresentation: '| Plan | Limit |\n| Gold | Single AC |', pageNumber: 8 },
      ];

      chunkService.findSimilarChunks.mockResolvedValue(mockChunks);
      chunkService.formatChunksForPrompt.mockReturnValue('[PASSAGE REF-1 | Page 5]: "Waiting period for PED is 36 months."');
      tableService.findRelevantTables.mockResolvedValue(mockTables);
      tableService.formatTablesForPrompt.mockReturnValue('[TABLE-1 | Page 8]: Room Rent Limits');

      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    parameters: {
                      waitingPeriodPED: '36 months',
                      waitingPeriodSpecific: '24 months',
                      waitingPeriodInitial: '30 days',
                      roomRentLimit: 'Single Private Room',
                      icuLimit: 'Actuals',
                      copay: 'Nil',
                      preHospitalization: '60 days',
                      postHospitalization: '90 days',
                      topExclusions: ['Cosmetic surgery', 'Weight control'],
                      restorationBenefit: '100% once per year',
                    },
                    executiveSummary: 'Solid comprehensive policy coverage with minimal sub-limits.',
                    reportMarkdown: '### Policy Audit\\n[Page 5] "Waiting period for PED is 36 months." Under Section 3.1, room rent is covered up to Single Private Room.',
                  }),
                },
              ],
            },
          },
        ],
      };

      fetch.mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      });

      chunkService.verifyCitations.mockReturnValue([
        {
          documentId: fileId,
          pageNumber: 5,
          excerpt: 'Waiting period for PED is 36 months.',
          verified: true,
        },
      ]);

      const result = await summaryService.generatePolicySummary(fileId, userId);

      expect(result.success).toBe(true);
      expect(result.fileName).toBe('Star_Comprehensive.pdf');
      expect(result.parameters.waitingPeriodPED).toBe('36 months');
      expect(result.parameters.copay).toBe('Nil');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].verified).toBe(true);
      expect(result.downloadMarkdown).toContain('# Actuarial Audit Report: Star_Comprehensive.pdf');
    });

    test('cascades to fallback candidate model when primary returns 503 Overloaded', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'ready',
        fileName: 'Care_Supreme.pdf',
        extractedText: 'Coverage details.',
      };
      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFile),
      });

      chunkService.findSimilarChunks.mockResolvedValue([]);
      tableService.findRelevantTables.mockResolvedValue([]);
      chunkService.verifyCitations.mockReturnValue([]);

      // First model returns 503, fallback model returns 200
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Model overloaded' } })),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          parameters: {
                            waitingPeriodPED: '24 months',
                            roomRentLimit: 'No Limit',
                          },
                          executiveSummary: 'Fallback model answered.',
                          reportMarkdown: 'Report body.',
                        }),
                      },
                    ],
                  },
                },
              ],
            })
          ),
        });

      const result = await summaryService.generatePolicySummary(fileId, userId);
      expect(result.success).toBe(true);
      expect(result.parameters.waitingPeriodPED).toBe('24 months');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('returns cached actuarialSummary instantly without calling Gemini if present', async () => {
      const cachedSummary = {
        success: true,
        fileId,
        parameters: { waitingPeriodPED: '36 months' },
        executiveSummary: 'Pre-computed summary.',
      };

      const mockFileWithSummary = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'ready',
        actuarialSummary: cachedSummary,
      };

      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFileWithSummary),
      });

      const res = await summaryService.generatePolicySummary(fileId, userId);

      expect(res).toBe(cachedSummary);
    });

    test('bypasses cache when forceRefresh: true is specified', async () => {
      const cachedSummary = {
        success: true,
        fileId,
        parameters: { waitingPeriodPED: '36 months' },
      };

      const mockFileWithSummary = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'ready',
        actuarialSummary: cachedSummary,
        extractedText: 'Sample policy text.',
      };

      jest.spyOn(File, 'findOne').mockReturnValue({
        select: jest.fn().mockResolvedValue(mockFileWithSummary),
      });

      fetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        parameters: { waitingPeriodPED: '48 months' },
                        executiveSummary: 'Updated summary.',
                        reportMarkdown: 'New report.',
                      }),
                    },
                  ],
                },
              },
            ],
          })
        ),
      });

      jest.spyOn(File, 'findByIdAndUpdate').mockResolvedValue(true);

      const res = await summaryService.generatePolicySummary(fileId, userId, { forceRefresh: true });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(res.parameters.waitingPeriodPED).toBe('48 months');
    });
  });
});
