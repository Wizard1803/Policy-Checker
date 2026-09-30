const express = require('express');
const router = express.Router();
const multer = require('multer');
const fetch = require('node-fetch');
const cloudinary = require('../config/cloudinary.config');
const File = require('../models/files.model');
const Table = require('../models/tables.model');
const { requireAuth } = require('../middleware/auth');
const documentService = require('../services/document.service');
const { enforceQuota } = require('../middleware/rate-limiter');
const quotaService = require('../services/quota.service');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') return cb(null, true);
        cb(new Error('Only PDF files are allowed'));
    },
});

// FILE UPLOAD
router.post(
    '/upload',
    requireAuth,
    (req, res, next) => {
        upload.single('policy')(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).send('File too large (max 15 MB).');
                }
                return res.status(400).send(err.message || 'Upload failed.');
            }
            if (!req.file) {
                return res.status(400).send('No file uploaded.');
            }
            next();
        });
    },
    enforceQuota('upload'),
    async (req, res) => {
        try {

            const uploadResult = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        folder: `policies/${req.user._id}`,
                        resource_type: 'raw',
                        overwrite: false,
                        access_mode: 'public',
                        type: 'upload',
                    },
                    (err, result) => {
                        if (err) return reject(err);
                        resolve(result);
                    }
                );
                stream.end(req.file.buffer);
            });

            const fileUrl = uploadResult?.secure_url;
            if (!fileUrl) {
                await quotaService.refundQuota(req.user._id, 'upload');
                console.error('Cloudinary upload missing secure_url:', uploadResult);
                return res.status(500).send('Upload failed.');
            }

            const newFile = new File({
                fileName: req.file.originalname,
                fileUrl,
                cloudinaryPublicId: uploadResult.public_id,
                cloudinaryVersion: uploadResult.version,
                uploadedBy: req.user._id,
                fileSizeBytes: req.file.size || req.file.buffer?.length || 0,
                processingState: 'uploaded',
            });

            await newFile.save();

            // Kick off asynchronous extraction pipeline in background
            setImmediate(() => {
                documentService.processDocument(newFile._id).catch((err) => {
                    console.error('Background processing error:', err.message);
                });
            });

            res.redirect('/');
        } catch (err) {
            await quotaService.refundQuota(req.user._id, 'upload');
            console.error('Upload error:', err);
            res.status(500).send('Something went wrong.');
        }
    }
);

// GET FILE STATUS
router.get('/files/:fileId/status', requireAuth, async (req, res) => {
    try {
        const fileDoc = await File.findById(req.params.fileId);
        if (!fileDoc || fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
            return res.status(404).json({ success: false, message: 'File not found or unauthorized.' });
        }

        const tableCount = await Table.countDocuments({
            fileId: req.params.fileId,
            uploadedBy: req.user._id,
        });

        res.json({
            success: true,
            processingState: fileDoc.processingState,
            pageCount: fileDoc.pageCount,
            tableCount,
            processingError: fileDoc.processingError,
            processedAt: fileDoc.processedAt,
        });
    } catch (err) {
        console.error('Status fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch file status.' });
    }
});

// GET FILE TABLES
router.get('/files/:fileId/tables', requireAuth, async (req, res) => {
    try {
        const fileDoc = await File.findById(req.params.fileId);
        if (!fileDoc || fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
            return res.status(404).json({ success: false, message: 'File not found or unauthorized.' });
        }

        const tables = await Table.find({
            fileId: req.params.fileId,
            uploadedBy: req.user._id,
        }).sort({ pageNumber: 1, tableIndex: 1 });

        res.json({ success: true, count: tables.length, tables });
    } catch (err) {
        console.error('Tables fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch document tables.' });
    }
});

// RENAME FILE
router.patch('/files/:fileId/rename', requireAuth, async (req, res) => {
    try {
        const { fileName } = req.body;
        const updatedFile = await documentService.renameDocument(req.params.fileId, req.user._id, fileName);
        res.json({ success: true, fileName: updatedFile.fileName });
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ success: false, message: err.message || 'Failed to rename file.' });
    }
});

// DELETE FILE
router.delete('/files/:fileId', requireAuth, async (req, res) => {
    try {
        const result = await documentService.deleteDocument(req.params.fileId, req.user._id);
        res.json({ success: true, message: 'File deleted successfully.', fileId: result.fileId });
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ success: false, message: err.message || 'Failed to delete file.' });
    }
});

// REPROCESS FILE
router.post('/files/:fileId/reprocess', requireAuth, async (req, res) => {
    try {
        const result = await documentService.reprocessDocument(req.params.fileId, req.user._id);
        res.json({ success: true, processingState: result.processingState });
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ success: false, message: err.message || 'Failed to reprocess file.' });
    }
});

// VIEW PDF INLINE (Feature I)
router.get('/files/:fileId/view-pdf', requireAuth, async (req, res) => {
    try {
        const fileDoc = await File.findById(req.params.fileId);
        if (!fileDoc || fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
            return res.status(404).json({ success: false, message: 'File not found or unauthorized.' });
        }


        if (fileDoc.processingState === 'failed') {
            return res.status(422).json({
                success: false,
                message: `Policy "${fileDoc.fileName}" processing failed. Please reprocess.`,
            });
        }

        if (!fileDoc.fileUrl) {
            return res.status(404).json({ success: false, message: 'File URL not found.' });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(fileDoc.fileUrl, { signal: controller.signal });
            if (!response.ok) {
                return res.status(502).json({ success: false, message: 'Failed to retrieve document from storage.' });
            }

            const safeName = (fileDoc.fileName || 'Policy')
                .replace(/\.[^/.]+$/, '')
                .replace(/[^a-zA-Z0-9_-]/g, '_');

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${safeName}.pdf"`);
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');

            if (response.body && typeof response.body.pipe === 'function') {
                response.body.on('error', (streamErr) => {
                    console.error('PDF stream error:', streamErr);
                    if (!res.headersSent) {
                        res.status(500).json({ success: false, message: 'Failed to stream document.' });
                    }
                });
                return response.body.pipe(res);
            }

            const buffer = response.buffer ? await response.buffer() : Buffer.from(await response.arrayBuffer());
            return res.send(buffer);
        } finally {
            clearTimeout(timeout);
        }
    } catch (err) {
        console.error('View PDF error:', err);
        res.status(500).json({ success: false, message: 'Failed to stream document.' });
    }
});

module.exports = router;

