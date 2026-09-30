const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const searchService = require('../services/search.service');

// DIRECT CLAUSE SEARCH (Feature F)
router.get('/files/:fileId/search', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const { q, limit } = req.query;

        const result = await searchService.searchPolicyClauses(
            fileId,
            req.user._id,
            q,
            { limit }
        );

        res.json(result);
    } catch (err) {
        const status = err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
        res.status(status).json({
            success: false,
            message: err.message || 'Failed to execute clause search.',
        });
    }
});

module.exports = router;
