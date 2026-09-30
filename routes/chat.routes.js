const express = require('express');
const router = express.Router();
const File = require('../models/files.model');
const { Conversation, Message } = require('../models/conversations.model');
const { requireAuth } = require('../middleware/auth');
const { enforceQuota } = require('../middleware/rate-limiter');
const chatService = require('../services/chat.service');
const tableService = require('../services/table.service');
const PDFParse = require('pdf-parse/lib/pdf-parse.js');
const fetch = require('node-fetch');
const geminiClient = require('../services/gemini.client');

function pdfDownloadUrl(fileDoc) {
    return fileDoc.fileUrl;
}

// MULTI-TURN POLICY CHAT (Phase B3)
router.post('/files/:fileId/chat', requireAuth, enforceQuota('query'), async (req, res) => {
    try {
        const { fileId } = req.params;
        const { message, conversationId } = req.body;

        const result = await chatService.processChatTurn(req.user._id, fileId, conversationId, message);
        res.json(result);
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ success: false, message: err.message || 'Chat turn failed.' });
    }
});

// LIST CONVERSATION SESSIONS (Group 4 Feature B4)
router.get('/files/:fileId/conversations', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const conversations = await chatService.listConversationsForFile(req.user._id, fileId);
        res.json({ success: true, conversations });
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ success: false, message: err.message || 'Failed to list conversations.' });
    }
});

// GET CHAT HISTORY (Phase B3)
router.get('/files/:fileId/chat/history', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const { conversationId } = req.query;

        let conversation;
        if (conversationId) {
            conversation = await Conversation.findOne({
                _id: conversationId,
                uploadedBy: req.user._id,
            });
        } else {
            conversation = await Conversation.findOne({
                fileIds: fileId,
                uploadedBy: req.user._id,
                isArchived: false,
            }).sort({ updatedAt: -1 });
        }

        if (!conversation) {
            return res.json({ success: true, conversationId: null, messages: [] });
        }

        const messages = await Message.find({ conversationId: conversation._id })
            .sort({ createdAt: 1 })
            .lean();

        res.json({
            success: true,
            conversationId: conversation._id,
            title: conversation.title,
            messages,
        });
    } catch (err) {
        console.error('Chat history fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch chat history.' });
    }
});

// LEGACY POLICY CHECK ROUTE
router.post('/check-policy/:fileId', requireAuth, enforceQuota('query'), async (req, res) => {
    try {
        const { fileId } = req.params;
        const { policyQuestion } = req.body;

        if (!policyQuestion) {
            return res.status(400).json({ success: false, message: 'Policy question required.' });
        }

        const fileDoc = await File.findById(fileId).select('+extractedText');

        if (!fileDoc || fileDoc.uploadedBy.toString() !== req.user._id.toString()) {
            return res.status(404).json({ success: false, message: 'Unauthorized or file not found.' });
        }

        if (fileDoc.processingState === 'uploaded' || fileDoc.processingState === 'processing') {
            return res.status(409).json({
                success: false,
                message: 'Document is currently being processed. Please wait until processing completes.',
            });
        }

        if (fileDoc.processingState === 'failed') {
            return res.status(422).json({
                success: false,
                message: fileDoc.processingError || 'Document processing failed. Please retry processing or re-upload.',
            });
        }

        let pdfText = fileDoc.extractedText;

        // Fallback for legacy files that were not processed by the async pipeline
        if (!pdfText || !pdfText.trim()) {
            const pdfFetchUrl = pdfDownloadUrl(fileDoc);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            let pdfResponse;
            try {
                pdfResponse = await fetch(pdfFetchUrl, {
                    headers: { 'User-Agent': 'policy-checker/1.0' },
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timeout);
            }

            if (!pdfResponse.ok) {
                const hint =
                    pdfResponse.status === 401
                        ? ' Cloudinary returned 401 (often fixed by re-uploading so we store public_id, or check delivery/access settings).'
                        : '';
                throw new Error(
                    `Failed to download PDF (${pdfResponse.status}).${hint}`
                );
            }
            const pdfBuffer = await pdfResponse.buffer();
            const data = await PDFParse(pdfBuffer);
            pdfText = data.text;

            if (pdfText && pdfText.trim()) {
                await File.findByIdAndUpdate(fileId, {
                    extractedText: pdfText,
                    pageCount: data.numpages || 1,
                    processingState: 'ready',
                    processedAt: new Date(),
                });
            }
        }

        if (!pdfText || !pdfText.trim()) {
            return res.status(422).json({
                success: false,
                message: 'No readable text could be extracted from this document.',
            });
        }

        // Retrieve relevant structured tables for hybrid prompt injection
        let relevantTables = [];
        try {
            relevantTables = await tableService.findRelevantTables(fileId, req.user._id, policyQuestion, { maxDirect: 15, limit: 10 });
        } catch (tableQueryErr) {
            console.warn(`Table retrieval warning for file ${fileId}:`, tableQueryErr.message);
        }

        const tablesBlock = tableService.formatTablesForPrompt(relevantTables);

        const prompt = tablesBlock
            ? `
You are an intelligent document query-solving agent.

Read the document text and relevant structured tables, and answer ONLY from them.
When citing tabular evidence, explicitly cite the table title, page number, and cell values.

${tablesBlock}

[DOCUMENT TEXT]:
"""
${pdfText}
"""

Question: "${policyQuestion}"

Respond with:
1. Answer
2. Reasoning
3. Key Extracts
`
            : `
You are an intelligent document query-solving agent.

Read the document text and answer ONLY from it.

Document:
"""
${pdfText}
"""

Question: "${policyQuestion}"

Respond with:
1. Answer
2. Reasoning
3. Key Extracts
`;
        const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS;

        if (!apiKey) {
            return res.status(500).json({
                success: false,
                message: 'GEMINI_API_KEY is not set in environment.',
            });
        }

        const apiResult = await geminiClient.generateContent({
            prompt,
            priority: 'high',
            timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 30000,
        });

        const blockReason = apiResult?.promptFeedback?.blockReason;
        if (blockReason) {
            console.error('Gemini blocked prompt:', apiResult.promptFeedback);
            return res.status(422).json({
                success: false,
                message: `Model blocked the request (${blockReason}). Try a shorter question or a smaller PDF.`,
            });
        }

        let llmResponse = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!llmResponse && Array.isArray(apiResult?.candidates?.[0]?.content?.parts)) {
            llmResponse = apiResult.candidates[0].content.parts
                .map((p) => p.text)
                .filter(Boolean)
                .join('\n');
        }

        if (!llmResponse) {
            console.error('Unexpected Gemini response:', JSON.stringify(apiResult).slice(0, 2000));
            return res.status(502).json({
                success: false,
                message:
                    'No text returned from the model. Check GEMINI_MODEL and API key, or try gemini-3.6-flash in .env.',
            });
        }

        res.json({
            success: true,
            policyResult: llmResponse,
            relevantTablesCount: relevantTables.length,
        });

    } catch (err) {
        const detail =
            err && typeof err.message === 'string' && err.message
                ? err.message
                : String(err);
        console.error('Policy check error:', detail, err?.stack || '');
        const safe = detail.slice(0, 500);
        res.status(500).json({ success: false, message: safe });
    }
});

module.exports = router;
