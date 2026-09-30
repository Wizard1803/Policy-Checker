const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const File = require('../models/files.model');
const Table = require('../models/tables.model');
const summaryService = require('../services/summary.service');
const pdfService = require('../services/pdf.service');

// EXPORT POLICY AUDIT SUMMARY (Feature E & Feature J)
router.get('/files/:fileId/export-summary', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const { format, refresh, force } = req.query;
        const forceRefresh = refresh === 'true' || force === 'true';

        const result = forceRefresh
            ? await summaryService.generatePolicySummary(fileId, req.user._id, { forceRefresh: true })
            : await summaryService.generatePolicySummary(fileId, req.user._id);

        if (format === 'json') {
            return res.json(result);
        }

        const safeName = (result.fileName || 'Policy')
            .replace(/\.[^/.]+$/, '')
            .replace(/[^a-zA-Z0-9_-]/g, '_');

        if (format === 'pdf') {
            const fileDoc = await File.findOne({ _id: fileId, uploadedBy: req.user._id });
            const tables = await Table.find({ fileId, uploadedBy: req.user._id }).sort({ pageNumber: 1, tableIndex: 1 });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}_Actuarial_Audit.pdf"`);
            pdfService.generateAuditReportPdf(result, fileDoc || { _id: fileId, fileName: result.fileName }, tables, res);
            return;
        }

        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_Audit_Summary.md"`);
        return res.send(result.downloadMarkdown);
    } catch (err) {
        const status = err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
        res.status(status).json({
            success: false,
            message: err.message || 'Failed to export policy summary.',
        });
    }
});

module.exports = router;

