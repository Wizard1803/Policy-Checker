const fetch = require('node-fetch');
const PDFParse = require('pdf-parse/lib/pdf-parse.js');
const cloudinary = require('../config/cloudinary.config');
const File = require('../models/files.model');
const Table = require('../models/tables.model');
const Chunk = require('../models/chunks.model');
const tableService = require('./table.service');
const chunkService = require('./chunk.service');
const chatService = require('./chat.service');

/**
 * Downloads and extracts text + page count from an uploaded PDF,
 * identifies candidate table pages, extracts structured tables with error isolation,
 * and transitions document state from 'processing' to 'ready' or 'failed'.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @returns {Promise<Object|undefined>}
 */
async function processDocument(fileId) {
  try {
    const fileDoc = await File.findById(fileId);
    if (!fileDoc) {
      console.error(`processDocument: File ${fileId} not found.`);
      return;
    }

    fileDoc.processingState = 'processing';
    fileDoc.processingError = null;
    await fileDoc.save();

    // 15-second timeout for downloading from Cloudinary
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let pdfResponse;
    try {
      pdfResponse = await fetch(fileDoc.fileUrl, {
        headers: { 'User-Agent': 'policy-checker/1.0' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF (${pdfResponse.status} ${pdfResponse.statusText})`);
    }

    const pdfBuffer = await pdfResponse.buffer();
    const ephemeralPages = [];
    let pageIndex = 0;

    const pagerender = async (pageData) => {
      pageIndex++;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      let lastY;
      let text = '';
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }

      if (pageIndex <= 300) {
        ephemeralPages.push({
          pageNumber: pageIndex,
          text: text ? text.trim() : ''
        });
      }
      return text;
    };

    const parsedData = await PDFParse(pdfBuffer, {
      pagerender,
      max: 300
    });

    const extractedText = (parsedData.text || '').trim();
    const pageCount = parsedData.numpages || 0;

    // Guardrail: Scanned image / empty text detection
    if (extractedText.length < 50) {
      throw new Error(
        'Scanned or image-only PDF detected. Text extraction is not supported for scanned images without OCR.'
      );
    }

    // Fallback if pagerender was not called (e.g. In unit test mocks)
    if (ephemeralPages.length === 0 && extractedText) {
      ephemeralPages.push({ pageNumber: 1, text: extractedText });
    }

    // Table extraction scored and capped to top candidate page to strictly respect 5 RPM limits
    const MAX_INGESTION_TABLE_PAGES = Math.max(1, Number(process.env.MAX_TABLE_PAGES) || 1);
    const candidateTablePages = ephemeralPages
      .filter((p) => tableService.isCandidateTablePage(p.text))
      .map((p) => {
        const pipeCount = (p.text.match(/\|/g) || []).length;
        const tabCount = (p.text.match(/\t/g) || []).length;
        const numericCount = (p.text.match(/(?:\d+%|\b(?:INR|Rs\.?|₹|\$)\s*\d+|\b\d+\s*(?:days|months|years)\b)/gi) || []).length;
        const score = (pipeCount * 3) + (tabCount * 3) + (numericCount * 2);
        return { ...p, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INGESTION_TABLE_PAGES);

    if (candidateTablePages.length > 0) {
      try {
        if (typeof tableService.extractTablesFromDocument === 'function') {
          await tableService.extractTablesFromDocument(
            fileDoc._id,
            fileDoc.uploadedBy,
            candidateTablePages
          );
        } else if (typeof tableService.extractTablesFromPage === 'function') {
          for (const page of candidateTablePages) {
            await tableService.extractTablesFromPage(
              fileDoc._id,
              fileDoc.uploadedBy,
              page.pageNumber,
              page.text
            );
          }
        }
      } catch (tableErr) {
        console.warn(`Table extraction error for file ${fileId}:`, tableErr.message);
      }
    }

    // Adaptive Semantic Chunking & Vector Embedding with error isolation
    try {
      if (ephemeralPages.length > 0) {
        await chunkService.indexDocumentChunks(
          fileDoc._id,
          fileDoc.uploadedBy,
          ephemeralPages
        );
      }
    } catch (chunkErr) {
      console.warn(
        `Chunk indexing warning for file ${fileId}:`,
        chunkErr.message
      );
    }

    // Update with extracted content and mark as ready
    fileDoc.pageCount = pageCount;
    fileDoc.extractedText = extractedText;
    fileDoc.processingState = 'ready';
    fileDoc.processingError = null;
    fileDoc.processedAt = new Date();
    await fileDoc.save();

    return fileDoc;
  } catch (err) {
    const sanitizedError =
      err?.name === 'AbortError'
        ? 'PDF download timed out after 15 seconds.'
        : err?.message
          ? err.message.slice(0, 300)
          : 'Document processing failed.';

    console.error(`processDocument error for ${fileId}:`, sanitizedError);

    try {
      await File.findByIdAndUpdate(fileId, {
        processingState: 'failed',
        processingError: sanitizedError,
        processedAt: new Date()
      });
    } catch (saveErr) {
      console.error(`Failed to update error state for ${fileId}:`, saveErr.message);
    }
  }
}

/**
 * Deletes a document, purging Cloudinary raw asset and removing DB document.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Object>}
 */
async function deleteDocument(fileId, userId) {
  const fileDoc = await File.findById(fileId);
  if (!fileDoc) {
    const err = new Error('File not found.');
    err.statusCode = 404;
    throw err;
  }

  if (fileDoc.uploadedBy.toString() !== userId.toString()) {
    const err = new Error('Unauthorized to delete this file.');
    err.statusCode = 403;
    throw err;
  }

  // Delete raw file from Cloudinary if publicId exists
  if (fileDoc.cloudinaryPublicId) {
    try {
      await cloudinary.uploader.destroy(fileDoc.cloudinaryPublicId, { resource_type: 'raw' });
    } catch (cldErr) {
      console.warn(`Cloudinary destroy warning for ${fileDoc.cloudinaryPublicId}:`, cldErr.message);
      // We continue with database deletion even if Cloudinary throws, to prevent ghost records
    }
  }

  // Cascading deletion: Purge all associated Table, Chunk, and Conversation documents
  await Table.deleteMany({ fileId, uploadedBy: userId });
  await Chunk.deleteMany({ fileId, uploadedBy: userId });
  await chatService.purgeConversationsForFile(fileId, userId);

  await File.findByIdAndDelete(fileId);
  return { success: true, fileId };
}

/**
 * Renames a document after verifying ownership.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} newName
 * @returns {Promise<Object>}
 */
async function renameDocument(fileId, userId, newName) {
  const fileDoc = await File.findById(fileId);
  if (!fileDoc) {
    const err = new Error('File not found.');
    err.statusCode = 404;
    throw err;
  }

  if (fileDoc.uploadedBy.toString() !== userId.toString()) {
    const err = new Error('Unauthorized to modify this file.');
    err.statusCode = 403;
    throw err;
  }

  const trimmed = typeof newName === 'string' ? newName.trim() : '';
  if (!trimmed || trimmed.length < 1) {
    const err = new Error('File name cannot be empty.');
    err.statusCode = 400;
    throw err;
  }

  // Preserve .pdf extension if user omitted it
  const finalName = trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
  fileDoc.fileName = finalName;
  await fileDoc.save();

  return fileDoc;
}

/**
 * Retries/reprocesses a failed or stalled document.
 *
 * @param {string|mongoose.Types.ObjectId} fileId
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Object>}
 */
async function reprocessDocument(fileId, userId) {
  const fileDoc = await File.findById(fileId);
  if (!fileDoc) {
    const err = new Error('File not found.');
    err.statusCode = 404;
    throw err;
  }

  if (fileDoc.uploadedBy.toString() !== userId.toString()) {
    const err = new Error('Unauthorized to reprocess this file.');
    err.statusCode = 403;
    throw err;
  }

  // Purge any previously extracted tables and chunks to avoid duplicates on reprocess
  await Table.deleteMany({ fileId, uploadedBy: userId });
  await Chunk.deleteMany({ fileId, uploadedBy: userId });

  fileDoc.processingState = 'processing';
  fileDoc.processingError = null;
  fileDoc.actuarialSummary = null;
  await fileDoc.save();

  // Asynchronously trigger processing without blocking response
  setImmediate(() => {
    processDocument(fileId).catch((err) => {
      console.error(`reprocessDocument background error:`, err.message);
    });
  });

  return { success: true, processingState: 'processing' };
}

/**
 * Startup recovery hook to prevent zombie processing states if server crashed.
 *
 * @returns {Promise<Object>}
 */
async function reconcileOrphanedFiles() {
  try {
    const result = await File.updateMany(
      { processingState: 'processing' },
      {
        processingState: 'failed',
        processingError: 'Processing was interrupted by a server restart. Please click Retry.',
        processedAt: new Date()
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`Reconciled ${result.modifiedCount} orphaned processing file(s).`);
    }
    return result;
  } catch (err) {
    console.error('reconcileOrphanedFiles error:', err.message);
  }
}

module.exports = {
  processDocument,
  deleteDocument,
  renameDocument,
  reprocessDocument,
  reconcileOrphanedFiles
};
