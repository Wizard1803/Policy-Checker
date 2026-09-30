const pdfService = require('../services/pdf.service');

describe('PDF Service - Actuarial Audit Report & Provenance (Feature J)', () => {
  describe('computeProvenanceHash', () => {
    it('returns a deterministic 16-character hexadecimal hash', () => {
      const fileId = '64b0f1a2c3d4e5f6a7b8c9d0';
      const page = 4;
      const excerpt = 'Room rent is capped at 1% of the sum insured per day.';

      const hash1 = pdfService.computeProvenanceHash(fileId, page, excerpt);
      const hash2 = pdfService.computeProvenanceHash(fileId, page, excerpt);

      expect(typeof hash1).toBe('string');
      expect(hash1).toHaveLength(16);
      expect(hash1).toMatch(/^[0-9a-f]{16}$/);
      expect(hash1).toBe(hash2);
    });

    it('normalizes whitespace and casing before hashing', () => {
      const fileId = '64b0f1a2c3d4e5f6a7b8c9d0';
      const hash1 = pdfService.computeProvenanceHash(fileId, 3, 'Pre-Existing Disease Waiting Period: 36 Months.');
      const hash2 = pdfService.computeProvenanceHash(fileId, 3, '  pre-existing disease waiting period:   36 months.  ');

      expect(hash1).toBe(hash2);
    });

    it('produces distinct hashes for different pages or excerpts', () => {
      const fileId = '64b0f1a2c3d4e5f6a7b8c9d0';
      const hashA = pdfService.computeProvenanceHash(fileId, 2, 'Room Rent limit 1%');
      const hashB = pdfService.computeProvenanceHash(fileId, 5, 'Room Rent limit 1%');
      const hashC = pdfService.computeProvenanceHash(fileId, 2, 'ICU limit 2%');

      expect(hashA).not.toBe(hashB);
      expect(hashA).not.toBe(hashC);
    });
  });

  describe('generateAuditReportPdf', () => {
    const mockSummaryData = {
      parameters: {
        waitingPeriodPED: '36 Months',
        waitingPeriodSpecific: '24 Months',
        waitingPeriodInitial: '30 Days',
        roomRentLimit: 'Single Private Room',
        icuLimit: 'No Sub-Limit',
        copay: 'Nil',
        preHospitalization: '60 Days',
        postHospitalization: '90 Days',
        topExclusions: ['Cosmetic Surgery', 'Hazardous Sports'],
        restorationBenefit: '100% Once per year',
      },
      executiveSummary: 'Comprehensive actuarial audit completed with clean coverage limits.',
      citations: [
        {
          pageNumber: 4,
          excerpt: 'Room rent is capped at single private room.',
          verified: true,
        },
      ],
    };

    const mockFileDoc = {
      _id: '64b0f1a2c3d4e5f6a7b8c9d0',
      fileName: 'HDFC_Optima_Secure.pdf',
      fileSizeBytes: 245000,
      pageCount: 18,
      uploadedAt: new Date('2026-03-01T10:00:00Z'),
    };

    const mockTables = [
      {
        pageNumber: 6,
        title: 'Room Rent Matrix',
        headers: ['Plan Type', 'Limit'],
        rows: [['Gold Plan', '1% of SI']],
      },
    ];

    it('generates a valid PDF stream starting with %PDF magic bytes', async () => {
      const chunks = [];
      const doc = pdfService.generateAuditReportPdf(mockSummaryData, mockFileDoc, mockTables);

      await new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', resolve);
        doc.on('error', reject);
      });

      const pdfBuffer = Buffer.concat(chunks);
      expect(pdfBuffer.length).toBeGreaterThan(500);

      // Standard PDF header check: %PDF-1.
      const header = pdfBuffer.slice(0, 8).toString('utf-8');
      expect(header).toMatch(/^%PDF-1\./);
    });

    it('handles empty or missing tables and citations gracefully', async () => {
      const chunks = [];
      const doc = pdfService.generateAuditReportPdf(
        { parameters: {}, executiveSummary: '', citations: [] },
        { _id: '123', fileName: 'Minimal.pdf' },
        []
      );

      await new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', resolve);
        doc.on('error', reject);
      });

      const pdfBuffer = Buffer.concat(chunks);
      expect(pdfBuffer.length).toBeGreaterThan(500);
      expect(pdfBuffer.slice(0, 8).toString('utf-8')).toMatch(/^%PDF-1\./);
    });
  });
});
