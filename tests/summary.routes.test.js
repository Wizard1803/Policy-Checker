const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_routes';
process.env.ATLAS_URI = process.env.ATLAS_URI || 'mongodb://localhost:27017/testdb';

// Mock DB connection, documentService, models, and cloudinary
jest.mock('../config/db', () => jest.fn());
jest.mock('../services/document.service', () => ({
  reconcileOrphanedFiles: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
}));
jest.mock('../models/user.model');
jest.mock('../models/files.model');
jest.mock('../models/tables.model');
jest.mock('../models/conversations.model');
jest.mock('../services/summary.service');
jest.mock('../config/cloudinary.config', () => ({
  uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
}));

const User = require('../models/user.model');
const File = require('../models/files.model');
const Table = require('../models/tables.model');
const summaryService = require('../services/summary.service');
const app = require('../app');

describe('Summary Route Endpoints - Actuarial Export (Feature E2)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  const ownerUser = {
    _id: ownerId,
    username: 'owneruser',
    email: 'owner@example.com',
  };

  const validToken = jwt.sign(
    { id: ownerId.toString(), email: ownerUser.email, username: ownerUser.username },
    process.env.JWT_SECRET
  );

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockImplementation((id) => {
      const userDoc = id && id.toString() === ownerId.toString() ? ownerUser : null;
      return {
        select: jest.fn().mockResolvedValue(userDoc),
        then: (resolve, reject) => Promise.resolve(userDoc).then(resolve, reject),
      };
    });
    File.findOne.mockResolvedValue({
      _id: fileId,
      fileName: 'Care_Advantage.pdf',
      uploadedAt: new Date('2026-03-01'),
      fileSizeBytes: 150000,
      pageCount: 12,
    });
    Table.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        { pageNumber: 2, title: 'Benefit Schedule', headers: ['Tier', 'Cap'], rows: [['Standard', '1%']] },
      ]),
    });
  });

  describe('GET /files/:fileId/export-summary', () => {
    test('redirects to /user/login if unauthenticated', async () => {
      const res = await request(app).get(`/files/${fileId}/export-summary`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/user/login');
    });

    test('returns error when summaryService throws not-found or unauthorized error', async () => {
      const err = new Error('File not found or unauthorized.');
      err.statusCode = 404;
      summaryService.generatePolicySummary.mockRejectedValue(err);

      const res = await request(app)
        .get(`/files/${fileId}/export-summary?format=json`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('not found');
    });

    test('returns 409 when policy is still in processing state', async () => {
      const err = new Error('Document is currently being processed.');
      err.statusCode = 409;
      summaryService.generatePolicySummary.mockRejectedValue(err);

      const res = await request(app)
        .get(`/files/${fileId}/export-summary?format=json`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('currently being processed');
    });

    test('returns 200 with JSON payload when format=json', async () => {
      const mockResult = {
        success: true,
        fileId: fileId.toString(),
        fileName: 'Care_Advantage.pdf',
        pageCount: 16,
        parameters: {
          waitingPeriodPED: '36 months',
          roomRentLimit: 'Single Private Room',
          copay: 'Nil',
        },
        executiveSummary: 'Policy provides full hospitalization coverage.',
        reportMarkdown: '# Detailed Findings',
        citations: [],
        downloadMarkdown: '# Download Content',
        generatedAt: new Date(),
      };

      summaryService.generatePolicySummary.mockResolvedValue(mockResult);

      const res = await request(app)
        .get(`/files/${fileId}/export-summary?format=json`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fileName).toBe('Care_Advantage.pdf');
      expect(res.body.parameters.waitingPeriodPED).toBe('36 months');
      expect(summaryService.generatePolicySummary).toHaveBeenCalledWith(
        fileId.toString(),
        ownerId
      );
    });

    test('returns 200 with markdown file attachment download by default', async () => {
      const mockResult = {
        success: true,
        fileId: fileId.toString(),
        fileName: 'Star_Health_Premier.pdf',
        downloadMarkdown: '# Actuarial Audit Report: Star_Health_Premier.pdf\n\nContent here.',
      };

      summaryService.generatePolicySummary.mockResolvedValue(mockResult);

      const res = await request(app)
        .get(`/files/${fileId}/export-summary`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('Star_Health_Premier_Audit_Summary.md');
      expect(res.text).toContain('# Actuarial Audit Report: Star_Health_Premier.pdf');
    });

    test('returns 200 with application/pdf binary download when format=pdf', async () => {
      const mockResult = {
        success: true,
        fileId: fileId.toString(),
        fileName: 'Care_Advantage.pdf',
        parameters: {
          waitingPeriodPED: '36 months',
          roomRentLimit: 'Single Private Room',
        },
        executiveSummary: 'Policy provides full hospitalization coverage.',
        reportMarkdown: '# Detailed Findings',
        citations: [],
      };

      summaryService.generatePolicySummary.mockResolvedValue(mockResult);

      const res = await request(app)
        .get(`/files/${fileId}/export-summary?format=pdf`)
        .set('Cookie', [`token=${validToken}`]);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('Care_Advantage_Actuarial_Audit.pdf');
      expect(res.body).toBeDefined();
    });
  });
});
