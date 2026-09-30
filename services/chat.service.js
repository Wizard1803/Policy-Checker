const geminiClient = require('./gemini.client');
const { Conversation, Message } = require('../models/conversations.model');
const File = require('../models/files.model');
const chunkService = require('./chunk.service');
const tableService = require('./table.service');

const MAX_CONTEXT_TURNS = 3; // 3 turns = 6 messages (User + Assistant pairs)
const MAX_QUERY_LENGTH = 1000;

/**
 * Retrieves an existing conversation with user tenant isolation, or initializes a new thread.
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} [conversationId]
 * @returns {Promise<Object>}
 */
async function getOrCreateConversation(userId, fileId, conversationId) {
  if (conversationId) {
    const existing = await Conversation.findOne({
      _id: conversationId,
      uploadedBy: userId,
      isArchived: false,
    });

    if (!existing) {
      const err = new Error('Conversation not found or unauthorized.');
      err.statusCode = 404;
      throw err;
    }

    // Ensure current file is referenced in conversation
    const hasFile = existing.fileIds.some((id) => id.toString() === fileId.toString());
    if (!hasFile) {
      existing.fileIds.push(fileId);
      await existing.save();
    }
    return existing;
  }

  const fileDoc = await File.findOne({ _id: fileId, uploadedBy: userId });
  if (!fileDoc) {
    const err = new Error('File not found or unauthorized.');
    err.statusCode = 404;
    throw err;
  }

  const title = fileDoc.fileName ? `Inquiry: ${fileDoc.fileName}` : 'Policy Inquiry';
  const newConv = new Conversation({
    uploadedBy: userId,
    fileIds: [fileId],
    title,
  });

  await newConv.save();
  return newConv;
}

/**
 * Retrieves the last N turns in chronological order for sliding context windowing.
 * @param {string|mongoose.Types.ObjectId} conversationId
 * @param {number} [maxTurns=3]
 * @returns {Promise<Array<Object>>}
 */
async function getRecentTurns(conversationId, maxTurns = MAX_CONTEXT_TURNS) {
  const limit = maxTurns * 2;
  const messages = await Message.find({ conversationId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return messages.reverse();
}

/**
 * Extracts candidate verbatim citations from model text and structured extracts.
 * @param {string} text
 * @param {Object} fileDoc
 * @returns {Array<Object>}
 */
function parseCitationsFromText(text, fileDoc) {
  if (!text || typeof text !== 'string') return [];

  const citations = [];
  const seenExcerpts = new Set();

  // Pattern 1: Tagged passages like [PASSAGE REF-1 | Page 4] or [Page 4]
  const pageRegex = /\[(?:PASSAGE\s+REF-\d+\s*\|\s*)?Page\s+(\d+)\]/gi;
  let pageMatch;
  while ((pageMatch = pageRegex.exec(text)) !== null) {
    const pageNum = parseInt(pageMatch[1], 10);
    // Find nearby quotation if available
    const surrounding = text.slice(pageMatch.index, pageMatch.index + 200);
    const quoteMatch = surrounding.match(/"([^"]{10,250})"/);
    const excerpt = quoteMatch ? quoteMatch[1] : '';

    if (excerpt && !seenExcerpts.has(excerpt.toLowerCase())) {
      seenExcerpts.add(excerpt.toLowerCase());
      citations.push({
        documentId: fileDoc._id,
        documentName: fileDoc.fileName,
        pageNumber: pageNum,
        excerpt,
        clauseTitle: `Page ${pageNum} Reference`,
      });
    }
  }

  // Pattern 2: Key Extracts bullet points containing quotes or page numbers
  const extractsRegex = /(?:Key\s*Extracts?|Evidence|Extracts?):\s*([\s\S]*?)$/i;
  const match = text.match(extractsRegex);
  if (match && match[1]) {
    const lines = match[1].split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cleanLine = line.replace(/^[-*•]\s*/, '').trim();
      const pMatch = cleanLine.match(/Page\s+(\d+)/i);
      const pageNumber = pMatch ? parseInt(pMatch[1], 10) : undefined;
      const qMatch = cleanLine.match(/"([^"]{10,250})"/);
      const excerpt = qMatch ? qMatch[1] : cleanLine.slice(0, 180);

      if (excerpt && excerpt.length >= 10 && !seenExcerpts.has(excerpt.toLowerCase())) {
        seenExcerpts.add(excerpt.toLowerCase());
        citations.push({
          documentId: fileDoc._id,
          documentName: fileDoc.fileName,
          pageNumber,
          excerpt,
          clauseTitle: 'Key Statutory Extract',
        });
      }
    }
  }

  return citations;
}

/**
 * Executes hybrid multi-turn chat retrieval, LLM generation, and citation verification.
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|null} conversationId
 * @param {string} userMessageText
 * @returns {Promise<Object>}
 */
async function processChatTurn(userId, fileId, conversationId, userMessageText) {
  if (!userMessageText || typeof userMessageText !== 'string' || !userMessageText.trim()) {
    const err = new Error('Message text is required.');
    err.statusCode = 400;
    throw err;
  }

  if (userMessageText.trim().length > MAX_QUERY_LENGTH) {
    const err = new Error(`Message exceeds maximum length of ${MAX_QUERY_LENGTH} characters.`);
    err.statusCode = 400;
    throw err;
  }

  const fileDoc = await File.findOne({ _id: fileId, uploadedBy: userId }).select('+extractedText');
  if (!fileDoc) {
    const err = new Error('File not found or unauthorized.');
    err.statusCode = 404;
    throw err;
  }

  if (fileDoc.processingState === 'uploaded' || fileDoc.processingState === 'processing') {
    const err = new Error('Document is currently being processed. Please wait until processing completes.');
    err.statusCode = 409;
    throw err;
  }

  if (fileDoc.processingState === 'failed') {
    const err = new Error(fileDoc.processingError || 'Document processing failed.');
    err.statusCode = 422;
    throw err;
  }

  const conversation = await getOrCreateConversation(userId, fileId, conversationId);
  const previousTurns = await getRecentTurns(conversation._id, MAX_CONTEXT_TURNS);

  // Hybrid Vector Retrieval & 2D Tabular Extraction
  const [candidateChunks, candidateTables] = await Promise.all([
    chunkService.findSimilarChunks(fileId, userId, userMessageText, 5),
    tableService.findRelevantTables(fileId, userId, userMessageText, { maxDirect: 15, limit: 10 }),
  ]);

  const passagesBlock = candidateChunks.length > 0
    ? chunkService.formatChunksForPrompt(candidateChunks)
    : fileDoc.extractedText
    ? `[DOCUMENT TEXT]:\n"""\n${fileDoc.extractedText.slice(0, 15000)}\n"""`
    : '';

  const tablesBlock = candidateTables.length > 0
    ? tableService.formatTablesForPrompt(candidateTables)
    : '';

  // Format previous dialogue turns
  let historyBlock = '';
  if (previousTurns.length > 0) {
    const turnsFormatted = previousTurns.map((m) =>
      `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.text.slice(0, 800)}`
    );
    historyBlock = `[CONVERSATION HISTORY]:\n${turnsFormatted.join('\n\n')}\n\n`;
  }

  const systemInstruction = `You are an intelligent insurance policy document analysis assistant.
Answer the user inquiry strictly and only from the provided passages and structured tables.
Rules:
1. When citing clauses, tag them with their exact page reference e.g., [Page X].
2. When citing tabular data, cite the table title and cell values.
3. Quote exact phrases in quotation marks so citations can be verified.
4. If the document does not contain sufficient details to answer, state that clearly without guessing.
5. Structure your reply with:
   1. Answer
   2. Reasoning
   3. Key Extracts (verbatim bullet points from the document)`;

  const prompt = `${systemInstruction}

${historyBlock}${tablesBlock ? tablesBlock + '\n\n' : ''}${passagesBlock}

Current Question: "${userMessageText}"`;

  const apiResult = await geminiClient.generateContent({
    prompt,
    priority: 'high',
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 30000,
  });

  const blockReason = apiResult?.promptFeedback?.blockReason;
  if (blockReason) {
    const err = new Error(`Model blocked the request (${blockReason}).`);
    err.statusCode = 422;
    throw err;
  }

  let modelResponseText = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!modelResponseText && Array.isArray(apiResult?.candidates?.[0]?.content?.parts)) {
    modelResponseText = apiResult.candidates[0].content.parts
      .map((p) => p.text)
      .filter(Boolean)
      .join('\n');
  }

  if (!modelResponseText) {
    const err = new Error('No response returned from model.');
    err.statusCode = 502;
    throw err;
  }

  // FACTUM Verification Protocol
  const rawCitations = parseCitationsFromText(modelResponseText, fileDoc);
  const verifiedCitations = chunkService.verifyCitations(
    rawCitations,
    candidateChunks,
    candidateTables
  );

  const tablesCited = candidateTables.map((t) => t._id);

  // Persist User Message and Model Message
  const userMsg = new Message({
    conversationId: conversation._id,
    sender: 'user',
    text: userMessageText.trim(),
  });

  const modelMsg = new Message({
    conversationId: conversation._id,
    sender: 'model',
    text: modelResponseText.trim(),
    citations: verifiedCitations,
    tablesCited,
  });

  // Auto-titling: if conversation has default title, update from user's first query
  const isDefaultTitle = !conversation.title ||
    conversation.title === 'Policy Inquiry' ||
    conversation.title.startsWith('Inquiry:') ||
    conversation.title.startsWith('Policy Inquiry:') ||
    conversation.title.toLowerCase().endsWith('.pdf');

  const conversationUpdates = { updatedAt: new Date() };
  if (isDefaultTitle) {
    const cleanQuestion = userMessageText.trim().replace(/\s+/g, ' ');
    const autoTitle = cleanQuestion.length > 45 ? `${cleanQuestion.slice(0, 42)}...` : cleanQuestion;
    conversationUpdates.title = autoTitle;
    conversation.title = autoTitle;
  }

  await Promise.all([
    userMsg.save(),
    modelMsg.save(),
    Conversation.findByIdAndUpdate(conversation._id, conversationUpdates),
  ]);

  return {
    success: true,
    conversationId: conversation._id,
    title: conversation.title,
    reply: {
      _id: modelMsg._id,
      text: modelMsg.text,
      citations: verifiedCitations,
      tablesCited,
      createdAt: modelMsg.createdAt,
    },
  };
}

/**
 * Lists all active conversations for a specific file belonging to the user.
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} fileId
 * @returns {Promise<Array<Object>>}
 */
async function listConversationsForFile(userId, fileId) {
  const conversations = await Conversation.find({
    uploadedBy: userId,
    fileIds: fileId,
    isArchived: false,
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!conversations || conversations.length === 0) {
    return [];
  }

  const convIds = conversations.map((c) => c._id);
  const messageCounts = await Message.aggregate([
    { $match: { conversationId: { $in: convIds } } },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);

  const countMap = new Map();
  messageCounts.forEach((m) => {
    countMap.set(m._id.toString(), m.count);
  });

  return conversations.map((c) => ({
    _id: c._id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: countMap.get(c._id.toString()) || 0,
  }));
}

/**
 * Purges or unlinks conversations associated with a deleted file.
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<{ deletedCount: number, unlinkedCount: number }>}
 */
async function purgeConversationsForFile(fileId, userId) {
  const conversations = await Conversation.find({
    uploadedBy: userId,
    fileIds: fileId,
  });

  if (!conversations || conversations.length === 0) {
    return { deletedCount: 0, unlinkedCount: 0 };
  }

  const singleFileConvIds = [];
  const multiFileConvIds = [];

  for (const conv of conversations) {
    if (conv.fileIds.length <= 1) {
      singleFileConvIds.push(conv._id);
    } else {
      multiFileConvIds.push(conv._id);
    }
  }

  let deletedCount = 0;
  if (singleFileConvIds.length > 0) {
    await Message.deleteMany({ conversationId: { $in: singleFileConvIds } });
    const res = await Conversation.deleteMany({ _id: { $in: singleFileConvIds } });
    deletedCount = res.deletedCount || singleFileConvIds.length;
  }

  let unlinkedCount = 0;
  if (multiFileConvIds.length > 0) {
    const res = await Conversation.updateMany(
      { _id: { $in: multiFileConvIds } },
      { $pull: { fileIds: fileId } }
    );
    unlinkedCount = res.modifiedCount || multiFileConvIds.length;
  }

  return { deletedCount, unlinkedCount };
}

module.exports = {
  getOrCreateConversation,
  getRecentTurns,
  parseCitationsFromText,
  processChatTurn,
  listConversationsForFile,
  purgeConversationsForFile,
};
