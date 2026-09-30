const mongoose = require('mongoose');
const File = require('../models/files.model');
const { Conversation, Message } = require('../models/conversations.model');
const {
  retrieveSymmetricContext,
  parseAndVerifyMultiDocCitations,
  buildComparisonPrompt,
  buildFollowupPrompt,
  callGeminiCascade,
} = require('./comparison-helpers');

const MIN_COMPARE_FILES = 2;
const MAX_COMPARE_FILES = 3;
const MAX_ASPECT_LENGTH = 500;
const DEFAULT_ASPECT = 'Comprehensive Policy Coverage & Key Limits';

/**
 * Validates file IDs for comparison: ensures 2-3 unique valid ObjectIds,
 * verifies ownership by userId, and confirms all files are in 'ready' state.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Array<string>} fileIds
 * @returns {Promise<Array<Object>>} Preserved ordered array of file documents
 */
async function validateComparisonFiles(userId, fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length < MIN_COMPARE_FILES || fileIds.length > MAX_COMPARE_FILES) {
    const err = new Error(`Please select between ${MIN_COMPARE_FILES} and ${MAX_COMPARE_FILES} distinct policies for comparison.`);
    err.statusCode = 400;
    throw err;
  }

  const uniqueIds = Array.from(new Set(fileIds.map((id) => String(id).trim())));
  if (uniqueIds.length !== fileIds.length) {
    const err = new Error('Duplicate policy files selected. Please select distinct policies.');
    err.statusCode = 400;
    throw err;
  }

  for (const id of uniqueIds) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error(`Invalid policy identifier: "${id}".`);
      err.statusCode = 400;
      throw err;
    }
  }

  const files = await File.find({
    _id: { $in: uniqueIds },
    uploadedBy: userId,
  }).select('+extractedText');

  if (files.length !== uniqueIds.length) {
    const err = new Error('One or more selected policies could not be found in your account.');
    err.statusCode = 404;
    throw err;
  }

  const fileMap = new Map(files.map((f) => [f._id.toString(), f]));
  const orderedFiles = uniqueIds.map((id) => fileMap.get(id));

  for (const file of orderedFiles) {
    if (file.processingState === 'uploaded' || file.processingState === 'processing') {
      const err = new Error(`Policy "${file.fileName}" is still processing. Please wait until indexing completes.`);
      err.statusCode = 409;
      throw err;
    }
    if (file.processingState === 'failed') {
      const err = new Error(`Policy "${file.fileName}" processing failed. Please reprocess the document before comparing.`);
      err.statusCode = 422;
      throw err;
    }
  }

  return orderedFiles;
}

/**
 * Executes a multi-policy comparative evaluation across 2 to 3 documents.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Array<string>} fileIds
 * @param {string} [aspect]
 * @param {boolean} [createConversation=false]
 * @returns {Promise<Object>}
 */
async function comparePolicies(userId, fileIds, aspect, createConversation = false) {
  const sanitizedAspect = typeof aspect === 'string' && aspect.trim()
    ? aspect.trim().slice(0, MAX_ASPECT_LENGTH)
    : DEFAULT_ASPECT;

  const orderedFiles = await validateComparisonFiles(userId, fileIds);

  const { retrievedDocs, formattedContextBlock } = await retrieveSymmetricContext(
    userId,
    orderedFiles,
    sanitizedAspect
  );

  const prompt = buildComparisonPrompt(sanitizedAspect, formattedContextBlock, orderedFiles);
  const modelResponseText = await callGeminiCascade(prompt);
  const verifiedCitations = parseAndVerifyMultiDocCitations(modelResponseText, retrievedDocs);

  let conversationId = null;
  if (createConversation) {
    const conversationTitle = `Comparison: ${orderedFiles.map((f) => f.fileName).join(' vs ')}`;
    const conversation = new Conversation({
      uploadedBy: userId,
      fileIds: orderedFiles.map((f) => f._id),
      title: conversationTitle.slice(0, 100),
    });
    await conversation.save();
    conversationId = conversation._id;

    const userMsg = new Message({
      conversationId: conversation._id,
      sender: 'user',
      text: `Compare policies on: ${sanitizedAspect}`,
    });

    const modelMsg = new Message({
      conversationId: conversation._id,
      sender: 'model',
      text: modelResponseText,
      citations: verifiedCitations,
    });

    await Promise.all([userMsg.save(), modelMsg.save()]);
  }

  return {
    success: true,
    aspect: sanitizedAspect,
    documents: orderedFiles.map((f) => ({
      id: f._id,
      name: f.fileName,
      pageCount: f.pageCount || 0,
    })),
    comparisonResult: modelResponseText,
    citations: verifiedCitations,
    conversationId,
  };
}

/**
 * Processes a multi-turn follow-up question across compared policies.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} conversationId
 * @param {Array<string>} [fileIds]
 * @param {string} userMessageText
 * @returns {Promise<Object>}
 */
async function processComparisonChatTurn(userId, conversationId, fileIds, userMessageText) {
  if (!userMessageText || typeof userMessageText !== 'string' || !userMessageText.trim()) {
    const err = new Error('Message text cannot be empty.');
    err.statusCode = 400;
    throw err;
  }
  const cleanMessage = userMessageText.trim().slice(0, 500);

  if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
    const err = new Error('Invalid conversation ID.');
    err.statusCode = 400;
    throw err;
  }

  const conversation = await Conversation.findOne({ _id: conversationId, uploadedBy: userId });
  if (!conversation) {
    const err = new Error('Conversation not found or unauthorized.');
    err.statusCode = 404;
    throw err;
  }

  const activeFileIds = Array.isArray(fileIds) && fileIds.length >= MIN_COMPARE_FILES
    ? fileIds
    : conversation.fileIds;

  const orderedFiles = await validateComparisonFiles(userId, activeFileIds);

  const recentMessages = await Message.find({ conversationId })
    .sort({ createdAt: -1 })
    .limit(6);
  const recentTurns = recentMessages.reverse();

  const { retrievedDocs, formattedContextBlock } = await retrieveSymmetricContext(
    userId,
    orderedFiles,
    cleanMessage
  );

  const prompt = buildFollowupPrompt(cleanMessage, formattedContextBlock, orderedFiles, recentTurns);
  const modelResponseText = await callGeminiCascade(prompt);
  const verifiedCitations = parseAndVerifyMultiDocCitations(modelResponseText, retrievedDocs);

  const userMsg = new Message({
    conversationId: conversation._id,
    sender: 'user',
    text: cleanMessage,
  });

  const modelMsg = new Message({
    conversationId: conversation._id,
    sender: 'model',
    text: modelResponseText,
    citations: verifiedCitations,
  });

  await Promise.all([userMsg.save(), modelMsg.save()]);

  return {
    success: true,
    conversationId: conversation._id,
    assistantMessage: {
      text: modelResponseText,
      citations: verifiedCitations,
      createdAt: modelMsg.createdAt || new Date(),
    },
  };
}

module.exports = {
  validateComparisonFiles,
  retrieveSymmetricContext,
  parseAndVerifyMultiDocCitations,
  comparePolicies,
  processComparisonChatTurn,
  MIN_COMPARE_FILES,
  MAX_COMPARE_FILES,
  DEFAULT_ASPECT,
};
