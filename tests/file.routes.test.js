const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_routes';
process.env.ATLAS_URI = process.env.ATLAS_URI || 'mongodb://localhost:27017/testdb';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test_gemini_api_key';

// Mock DB connection, documentService, models, node-fetch, and pdf-parse
jest.mock('../config/db', () => jest.fn());
jest.mock('../services/document.service', () => ({
  reconcileOrphanedFiles: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  processDocument: jest.fn().mockResolvedValue({}),
  renameDocument: jest.fn(),
  deleteDocument: jest.fn(),
  reprocessDocument: jest.fn()
}));
jest.mock('../models/user.model');
jest.mock('../models/files.model');
jest.mock('../models/tables.model', () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockResolvedValue([])
  })
}));
jest.mock('../services/table.service', () => ({
  findRelevantTables: jest.fn().mockResolvedValue([]),
  formatTablesForPrompt: jest.fn().mockReturnValue('')
}));
jest.mock('node-fetch');
jest.mock('pdf-parse/lib/pdf-parse.js');
jest.mock('../config/cloudinary.config', () => ({
  uploader: {
    destroy: jest.fn().mockResolvedValue({ result: 'ok' })
  }
}));

const User = require('../models/user.model');
const File = require('../models/files.model');
const Table = require('../models/tables.model');
const fetch = require('node-fetch');
const PDFParse = require('pdf-parse/lib/pdf-parse.js');
const documentService = require('../services/document.service');
const app = require('../app');

describe('File Management Route Endpoints (routes/file.routes.js)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const strangerId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  const ownerUser = {
    _id: ownerId,
    username: 'owneruser',
    email: 'owner@example.com'
  };

  const validToken = jwt.sign(
    { id: ownerId.toString(), email: ownerUser.email, username: ownerUser.username },
    process.env.JWT_SECRET
  );

  const mockFileFindById = (doc) => {
    File.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(doc),
      then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockImplementation((id) => {
      const userDoc = id && id.toString() === ownerId.toString() ? ownerUser : null;
      return {
        select: jest.fn().mockResolvedValue(userDoc),
        then: (resolve, reject) => Promise.resolve(userDoc).then(resolve, reject)
      };
    });
  });

  describe('GET /files/:fileId/status', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app).get(`/files/${fileId}/status`);
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/user/login');
    });

    test('returns 404 if file belongs to another user', async () => {
      mockFileFindById({
        _id: fileId,
        uploadedBy: strangerId,
        processingState: 'ready'
      });

      const res = await request(app)
        .get(`/files/${fileId}/status`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('returns status details when requested by file owner', async () => {
      mockFileFindById({
        _id: fileId,
        uploadedBy: ownerId,
        processingState: 'ready',
        pageCount: 18,
        processingError: null,
        processedAt: new Date('2026-09-01')
      });

      const res = await request(app)
        .get(`/files/${fileId}/status`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processingState).toBe('ready');
      expect(res.body.pageCount).toBe(18);
    });
  });

  describe('PATCH /files/:fileId/rename', () => {
    test('successfully renames file for authenticated owner', async () => {
      documentService.renameDocument.mockResolvedValue({
        _id: fileId,
        fileName: 'new-policy-title.pdf'
      });

      const res = await request(app)
        .patch(`/files/${fileId}/rename`)
        .set('Cookie', [`token=${validToken}`])
        .send({ fileName: 'new-policy-title.pdf' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fileName).toBe('new-policy-title.pdf');
      expect(documentService.renameDocument).toHaveBeenCalledWith(
        fileId.toString(),
        ownerId,
        'new-policy-title.pdf'
      );
    });

    test('returns error if service throws validation or ownership error', async () => {
      const err = new Error('File name cannot be empty.');
      err.statusCode = 400;
      documentService.renameDocument.mockRejectedValue(err);

      const res = await request(app)
        .patch(`/files/${fileId}/rename`)
        .set('Cookie', [`token=${validToken}`])
        .send({ fileName: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('File name cannot be empty.');
    });
  });

  describe('DELETE /files/:fileId', () => {
    test('successfully deletes file for authenticated owner', async () => {
      documentService.deleteDocument.mockResolvedValue({
        success: true,
        fileId: fileId.toString()
      });

      const res = await request(app)
        .delete(`/files/${fileId}`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(documentService.deleteDocument).toHaveBeenCalledWith(
        fileId.toString(),
        ownerId
      );
    });

    test('returns 403 when user is not authorized to delete', async () => {
      const err = new Error('Unauthorized to delete this file.');
      err.statusCode = 403;
      documentService.deleteDocument.mockRejectedValue(err);

      const res = await request(app)
        .delete(`/files/${fileId}`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Unauthorized to delete this file.');
    });
  });

  describe('POST /files/:fileId/reprocess', () => {
    test('successfully triggers reprocess for authenticated owner', async () => {
      documentService.reprocessDocument.mockResolvedValue({
        success: true,
        processingState: 'processing'
      });

      const res = await request(app)
        .post(`/files/${fileId}/reprocess`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processingState).toBe('processing');
    });
  });

  describe('GET / (Home View Rendering - Phase 4)', () => {
    test('renders home page with file cards, correct status badges, and no emojis', async () => {
      const mockFiles = [
        {
          _id: new mongoose.Types.ObjectId(),
          fileName: 'health_policy.pdf',
          fileUrl: 'https://example.com/health.pdf',
          uploadedBy: ownerId,
          processingState: 'ready',
          pageCount: 14,
          uploadedAt: new Date('2026-09-01')
        },
        {
          _id: new mongoose.Types.ObjectId(),
          fileName: 'auto_policy.pdf',
          fileUrl: 'https://example.com/auto.pdf',
          uploadedBy: ownerId,
          processingState: 'processing',
          pageCount: 0,
          uploadedAt: new Date('2026-09-02')
        },
        {
          _id: new mongoose.Types.ObjectId(),
          fileName: 'broken_policy.pdf',
          fileUrl: 'https://example.com/broken.pdf',
          uploadedBy: ownerId,
          processingState: 'failed',
          processingError: 'Scanned or image-only PDF detected.',
          pageCount: 0,
          uploadedAt: new Date('2026-09-03')
        }
      ];

      File.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockFiles)
      });

      const res = await request(app)
        .get('/')
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.text).toContain('health_policy.pdf');
      expect(res.text).toContain('Ready &bull; 14 pages');
      expect(res.text).toContain('badge-processing');
      expect(res.text).toContain('badge-failed');
      expect(res.text).toContain('Retry');
      expect(res.text).toContain('Check Policy');
      // Assert zero emoji characters in rendered HTML
      const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      expect(emojiRegex.test(res.text)).toBe(false);
    });

    test('renders file cards with table counts, view tables button, and table inspector modal', async () => {
      const mockFiles = [
        {
          _id: new mongoose.Types.ObjectId(),
          fileName: 'health_policy_with_tables.pdf',
          fileUrl: 'https://example.com/health.pdf',
          uploadedBy: ownerId,
          processingState: 'ready',
          pageCount: 14,
          tableCount: 3,
          uploadedAt: new Date('2026-09-01')
        }
      ];

      File.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockFiles)
      });

      const res = await request(app)
        .get('/')
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.text).toContain('Ready &bull; 14 pages &bull; 3 tables');
      expect(res.text).toContain('view-tables-btn');
      expect(res.text).toContain('Tables');
      expect(res.text).toContain('tableInspectorModal');
      expect(res.text).toContain('audit-report-btn');
      expect(res.text).toContain('Audit Report');
      expect(res.text).toContain('auditReportModal');
      expect(res.text).toContain('Actuarial Policy Audit Report');
      expect(res.text).toContain('search-clauses-btn');
      expect(res.text).toContain('Search');
      expect(res.text).toContain('clauseSearchModal');
      expect(res.text).toContain('Semantic Clause Finder');
      const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      expect(emojiRegex.test(res.text)).toBe(false);
    });

    test('renders compare checkboxes on cards, floating comparison bar, and compare modal', async () => {
      const mockFiles = [
        {
          _id: new mongoose.Types.ObjectId(),
          fileName: 'health_policy.pdf',
          fileUrl: 'https://example.com/health.pdf',
          uploadedBy: ownerId,
          processingState: 'ready',
          pageCount: 14,
          uploadedAt: new Date('2026-09-01')
        },
        {
          _id: new mongoose.Types.ObjectId(),
          fileName: 'auto_policy.pdf',
          fileUrl: 'https://example.com/auto.pdf',
          uploadedBy: ownerId,
          processingState: 'processing',
          pageCount: 0,
          uploadedAt: new Date('2026-09-02')
        }
      ];

      File.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockFiles)
      });

      const res = await request(app)
        .get('/')
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.text).toContain('compare-checkbox');
      expect(res.text).toContain('compareFloatingBar');
      expect(res.text).toContain('compareModal');
      expect(res.text).toContain('Multi-Policy Comparative Analysis');
      expect(res.text).toContain('Compare Policies');
      const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      expect(emojiRegex.test(res.text)).toBe(false);
    });

    test('renders empty state when user has no files', async () => {
      File.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([])
      });

      const res = await request(app)
        .get('/')
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.text).toContain('No files uploaded yet.');
    });
  });

  describe('POST /check-policy/:fileId (Query Optimization & Fast-Path - Phase 5)', () => {
    const validFileId = new mongoose.Types.ObjectId();

    beforeEach(() => {
      fetch.mockReset();
      PDFParse.mockReset();
    });

    test('returns 400 if policyQuestion is missing', async () => {
      const res = await request(app)
        .post(`/check-policy/${validFileId}`)
        .set('Cookie', [`token=${validToken}`])
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Policy question required.');
    });

    test('returns 404 if file does not exist or belongs to another user', async () => {
      mockFileFindById({
        _id: validFileId,
        uploadedBy: strangerId,
        processingState: 'ready'
      });

      const res = await request(app)
        .post(`/check-policy/${validFileId}`)
        .set('Cookie', [`token=${validToken}`])
        .send({ policyQuestion: 'What is the copay?' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Unauthorized or file not found');
    });

    test('returns 409 Conflict if document is currently in processing state', async () => {
      mockFileFindById({
        _id: validFileId,
        uploadedBy: ownerId,
        processingState: 'processing'
      });

      const res = await request(app)
        .post(`/check-policy/${validFileId}`)
        .set('Cookie', [`token=${validToken}`])
        .send({ policyQuestion: 'What is the deductible?' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('currently being processed');
    });

    test('returns 422 Unprocessable Entity if document processing failed', async () => {
      mockFileFindById({
        _id: validFileId,
        uploadedBy: ownerId,
        processingState: 'failed',
        processingError: 'Scanned or image-only PDF detected.'
      });

      const res = await request(app)
        .post(`/check-policy/${validFileId}`)
        .set('Cookie', [`token=${validToken}`])
        .send({ policyQuestion: 'Is inpatient care covered?' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Scanned or image-only PDF detected.');
    });

    test('fast-path: answers query using cached extractedText without Cloudinary download or pdf-parse', async () => {
      mockFileFindById({
        _id: validFileId,
        uploadedBy: ownerId,
        processingState: 'ready',
        pageCount: 12,
        extractedText: 'Comprehensive Medical Policy 2026. Section 4: Inpatient hospital care covered at 90% after deductible.'
      });

      // Mock Gemini API response
      fetch.mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
          return Promise.resolve({
            ok: true,
            text: async () => JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { text: '**Answer:** Inpatient care is covered at 90%.\n\n**Reasoning:** Clause 4 specifies 90% post deductible.\n\n**Key Extracts:** Section 4' }
                    ]
                  }
                }
              ]
            })
          });
        }
        return Promise.reject(new Error(`Unexpected fetch call to: ${url}`));
      });

      const res = await request(app)
        .post(`/check-policy/${validFileId}`)
        .set('Cookie', [`token=${validToken}`])
        .send({ policyQuestion: 'What is inpatient coverage?' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.policyResult).toContain('Inpatient care is covered at 90%');

      // CRITICAL ASSERTION: Neither PDFParse nor Cloudinary fetch was invoked
      expect(PDFParse).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1); // Only Gemini called
    });

    test('legacy-path: downloads and parses PDF when extractedText is missing, caches text, and answers query', async () => {
      mockFileFindById({
        _id: validFileId,
        uploadedBy: ownerId,
        processingState: 'ready',
        fileUrl: 'https://res.cloudinary.com/test/policy.pdf',
        extractedText: null // Legacy file
      });

      PDFParse.mockResolvedValue({
        text: 'Legacy Policy Text. Dental checkups covered twice per year.',
        numpages: 2
      });

      fetch.mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('cloudinary.com')) {
          return Promise.resolve({
            ok: true,
            buffer: async () => Buffer.from('%PDF-1.4 dummy buffer')
          });
        }
        if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
          return Promise.resolve({
            ok: true,
            text: async () => JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { text: '**Answer:** Dental is covered twice per year.\n\n**Reasoning:** Clause states twice yearly.\n\n**Key Extracts:** Dental checkups' }
                    ]
                  }
                }
              ]
            })
          });
        }
        return Promise.reject(new Error(`Unexpected fetch call to: ${url}`));
      });

      const res = await request(app)
        .post(`/check-policy/${validFileId}`)
        .set('Cookie', [`token=${validToken}`])
        .send({ policyQuestion: 'Are dental checkups covered?' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.policyResult).toContain('Dental is covered twice per year');

      // Assert legacy path executed PDFParse and cached to DB
      expect(PDFParse).toHaveBeenCalledTimes(1);
      expect(File.findByIdAndUpdate).toHaveBeenCalledWith(
        validFileId.toString(),
        expect.objectContaining({
          extractedText: 'Legacy Policy Text. Dental checkups covered twice per year.',
          pageCount: 2,
          processingState: 'ready'
        })
      );
    });
  });

  describe('GET /files/:fileId/tables', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app).get(`/files/${fileId}/tables`);
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/user/login');
    });

    test('returns 404 when file belongs to another user (strict tenant isolation)', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        uploadedBy: strangerId,
        fileName: 'stranger-policy.pdf',
      });

      const res = await request(app)
        .get(`/files/${fileId}/tables`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('File not found or unauthorized');
    });

    test('returns 200 with list of structured tables for authenticated owner', async () => {
      File.findById.mockResolvedValue({
        _id: fileId,
        uploadedBy: ownerId,
        fileName: 'my-policy.pdf',
      });

      const mockTables = [
        {
          _id: new mongoose.Types.ObjectId(),
          fileId,
          uploadedBy: ownerId,
          pageNumber: 6,
          tableIndex: 0,
          title: 'Room Rent Limits',
          headers: ['Plan', 'Limit'],
          rows: [['Gold', 'Single Room']],
          markdownRepresentation: '| Plan | Limit |\n| --- | --- |\n| Gold | Single Room |',
        },
      ];

      Table.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockTables),
      });

      const res = await request(app)
        .get(`/files/${fileId}/tables`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
    });
  });
});
