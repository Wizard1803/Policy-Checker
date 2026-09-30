const express = require('express');
const router = express.Router();
const File = require('../models/files.model');
const Table = require('../models/tables.model');
const { protect } = require('../middleware/auth');

// Modular sub-routers
const fileRoutes = require('./file.routes');
const chatRoutes = require('./chat.routes');
const compareRoutes = require('./compare.routes');
const summaryRoutes = require('./summary.routes');
const searchRoutes = require('./search.routes');

// HOME ROUTE
router.get('/', protect, async (req, res) => {
    let files = [];
    if (req.user) {
        try {
            const rawFiles = await File.find({ uploadedBy: req.user._id }).sort({ uploadedAt: -1 });
            files = Array.isArray(rawFiles)
                ? rawFiles.map((f) => (typeof f.toObject === 'function' ? f.toObject() : { ...f }))
                : [];

            const fileIds = files.map((f) => f._id);
            if (fileIds.length > 0 && typeof Table.aggregate === 'function') {
                const counts = await Table.aggregate([
                    { $match: { fileId: { $in: fileIds }, uploadedBy: req.user._id } },
                    { $group: { _id: '$fileId', count: { $sum: 1 } } },
                ]);
                const countMap = new Map();
                if (Array.isArray(counts)) {
                    for (const c of counts) {
                        countMap.set(c._id.toString(), c.count);
                    }
                }
                for (const file of files) {
                    file.tableCount = countMap.get(file._id.toString()) || 0;
                }
            }
        } catch (error) {
            console.error('Error fetching user files:', error);
        }
    }
    res.render('home', { files: files, user: req.user });
});

// Mount domain-specific sub-routers
router.use('/', fileRoutes);
router.use('/', chatRoutes);
router.use('/', compareRoutes);
router.use('/', summaryRoutes);
router.use('/', searchRoutes);

module.exports = router;