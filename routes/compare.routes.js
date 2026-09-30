const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { enforceQuota } = require('../middleware/rate-limiter');
const comparisonService = require('../services/comparison.service');
const quotaService = require('../services/quota.service');

// MULTI-DOCUMENT POLICY COMPARISON (Feature C & Feature H)
router.post('/compare-policies', requireAuth, enforceQuota('query'), async (req, res) => {
    try {
        const { fileIds, aspect, createConversation } = req.body;
        // Default createConversation to true for seamless follow-up chat
        const shouldCreateConv = createConversation === undefined ? true : Boolean(createConversation);

        const result = await comparisonService.comparePolicies(
            req.user._id,
            fileIds,
            aspect,
            shouldCreateConv
        );
        res.json(result);
    } catch (err) {
        await quotaService.refundQuota(req.user._id, 'query');
        const status = err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
        res.status(status).json({
            success: false,
            message: err.message || 'An error occurred during policy comparison.',
        });
    }
});

// MULTI-DOCUMENT POLICY COMPARISON FOLLOW-UP CHAT (Feature H)
router.post('/compare-policies/chat', requireAuth, enforceQuota('query'), async (req, res) => {
    try {
        const { conversationId, fileIds, userMessageText } = req.body;
        const result = await comparisonService.processComparisonChatTurn(
            req.user._id,
            conversationId,
            fileIds,
            userMessageText
        );
        res.json(result);
    } catch (err) {
        await quotaService.refundQuota(req.user._id, 'query');
        const status = err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
        res.status(status).json({
            success: false,
            message: err.message || 'An error occurred during follow-up comparison chat.',
        });
    }
});

module.exports = router;

