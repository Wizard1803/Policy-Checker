const mongoose = require('mongoose');

// Mock dependencies before importing service
jest.mock('node-fetch');
jest.mock('pdf-parse/lib/pdf-parse.js');
jest.mock('../config/cloudinary.config', () => ({
  uploader: {
    destroy: jest.fn().mockResolvedValue({ result: 'ok' })
  }
}));
jest.mock('../models/files.model');
jest.mock('../models/tables.model', () => ({
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 })
}));
jest.mock('../models/chunks.model', () => ({
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 })
}));
jest.mock('../services/table.service', () => ({
  isCandidateTablePage: jest.fn().mockReturnValue(false),
  extractTablesFromPage: jest.fn().mockResolvedValue([])
}));
jest.mock('../services/chunk.service', () => ({
  indexDocumentChunks: jest.fn().mockResolvedValue([])
}));
jest.mock('../services/chat.service', () => ({
  purgeConversationsForFile: jest.fn().mockResolvedValue({ deletedConversations: 0, deletedMessages: 0 })
}));

const fetch = require('node-fetch');
const PDFParse = require('pdf-parse/lib/pdf-parse.js');
const cloudinary = require('../config/cloudinary.config');
const File = require('../models/files.model');
const Table = require('../models/tables.model');
const Chunk = require('../models/chunks.model');
const tableService = require('../services/table.service');
const chunkService = require('../services/chunk.service');
const chatService = require('../services/chat.service');
const documentService = require('../services/document.service');

describe('Document Processing Service (Phase 2)', () => {
  const userId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processDocument', () => {
    test('successfully extracts text, pageCount, and transitions to ready', async () => {
      const mockFile = {
        _id: fileId,
        fileUrl: 'https://cloudinary.com/policy.pdf',
        processingState: 'uploaded',
        save: jest.fn().mockResolvedValue(true)
      };
      File.findById.mockResolvedValue(mockFile);

      // Mock fetch returning a buffer
      const mockBuffer = Buffer.from('fake pdf data');
      fetch.mockResolvedValue({
        ok: true,
        buffer: jest.fn().mockResolvedValue(mockBuffer)
      });

      // Mock pdf-parse
      PDFParse.mockResolvedValue({
        numpages: 14,
        text: 'This is a sample extracted insurance policy with more than fifty characters to pass the scanned check.'
      });

      const result = await documentService.processDocument(fileId);

      expect(File.findById).toHaveBeenCalledWith(fileId);
      expect(fetch).toHaveBeenCalledWith('https://cloudinary.com/policy.pdf', expect.any(Object));
      expect(mockFile.processingState).toBe('ready');
      expect(mockFile.pageCount).toBe(14);
      expect(mockFile.extractedText).toContain('sample extracted insurance policy');
      expect(mockFile.processingError).toBeNull();
      expect(mockFile.save).toHaveBeenCalled();
      expect(chunkService.indexDocumentChunks).toHaveBeenCalled();
      expect(result).toBe(mockFile);
    });

    test('extracts tables for candidate pages and isolates extraction errors without failing document', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        fileUrl: 'https://cloudinary.com/tabular-policy.pdf',
        processingState: 'uploaded',
        save: jest.fn().mockResolvedValue(true)
      };
      File.findById.mockResolvedValue(mockFile);

      fetch.mockResolvedValue({
        ok: true,
        buffer: jest.fn().mockResolvedValue(Buffer.from('fake pdf data'))
      });

      PDFParse.mockResolvedValue({
        numpages: 2,
        text: 'This is a sample extracted insurance policy with more than fifty characters to pass the scanned check.'
      });

      tableService.isCandidateTablePage.mockReturnValue(true);
      tableService.extractTablesFromPage.mockRejectedValue(new Error('Rate limited by Gemini'));

      const result = await documentService.processDocument(fileId);

      expect(tableService.isCandidateTablePage).toHaveBeenCalled();
      expect(tableService.extractTablesFromPage).toHaveBeenCalledWith(
        fileId,
        userId,
        1,
        expect.stringContaining('sample extracted insurance policy')
      );
      // Verify error isolation: file still transitioned to ready state
      expect(mockFile.processingState).toBe('ready');
      expect(mockFile.save).toHaveBeenCalled();
      expect(result).toBe(mockFile);
    });

    test('detects scanned PDF (< 50 chars) and transitions to failed state', async () => {
      const mockFile = {
        _id: fileId,
        fileUrl: 'https://cloudinary.com/scanned.pdf',
        processingState: 'uploaded',
        save: jest.fn().mockResolvedValue(true)
      };
      File.findById.mockResolvedValue(mockFile);
      File.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

      fetch.mockResolvedValue({
        ok: true,
        buffer: jest.fn().mockResolvedValue(Buffer.from('scanned'))
      });

      PDFParse.mockResolvedValue({
        numpages: 2,
        text: '   short   '
      });

      await documentService.processDocument(fileId);

      expect(File.findByIdAndUpdate).toHaveBeenCalledWith(
        fileId,
        expect.objectContaining({
          processingState: 'failed',
          processingError: expect.stringContaining('Scanned or image-only PDF detected')
        })
      );
    });

    test('handles download network failure and updates error state', async () => {
      const mockFile = {
        _id: fileId,
        fileUrl: 'https://cloudinary.com/broken.pdf',
        processingState: 'uploaded',
        save: jest.fn().mockResolvedValue(true)
      };
      File.findById.mockResolvedValue(mockFile);
      File.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

      fetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      await documentService.processDocument(fileId);

      expect(File.findByIdAndUpdate).toHaveBeenCalledWith(
        fileId,
        expect.objectContaining({
          processingState: 'failed',
          processingError: expect.stringContaining('Failed to download PDF')
        })
      );
    });
  });

  describe('deleteDocument', () => {
    test('enforces ownership and calls Cloudinary destroy and DB delete', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        cloudinaryPublicId: 'policies/123/doc1'
      };
      File.findById.mockResolvedValue(mockFile);
      File.findByIdAndDelete = jest.fn().mockResolvedValue(mockFile);

      const result = await documentService.deleteDocument(fileId, userId);

      expect(File.findById).toHaveBeenCalledWith(fileId);
      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('policies/123/doc1', { resource_type: 'raw' });
      expect(Table.deleteMany).toHaveBeenCalledWith({ fileId, uploadedBy: userId });
      expect(Chunk.deleteMany).toHaveBeenCalledWith({ fileId, uploadedBy: userId });
      expect(chatService.purgeConversationsForFile).toHaveBeenCalledWith(fileId, userId);
      expect(File.findByIdAndDelete).toHaveBeenCalledWith(fileId);
      expect(result).toEqual({ success: true, fileId });
    });

    test('rejects deletion when user is not the owner (403)', async () => {
      const differentUser = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        uploadedBy: userId
      };
      File.findById.mockResolvedValue(mockFile);

      await expect(documentService.deleteDocument(fileId, differentUser)).rejects.toThrow('Unauthorized to delete this file.');
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    test('rejects deletion when file does not exist (404)', async () => {
      File.findById.mockResolvedValue(null);

      await expect(documentService.deleteDocument(fileId, userId)).rejects.toThrow('File not found.');
    });
  });

  describe('renameDocument', () => {
    test('renames file, trims whitespace, and ensures .pdf extension', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        fileName: 'old-name.pdf',
        save: jest.fn().mockResolvedValue(true)
      };
      File.findById.mockResolvedValue(mockFile);

      const renamed = await documentService.renameDocument(fileId, userId, '  renamed-policy  ');

      expect(mockFile.fileName).toBe('renamed-policy.pdf');
      expect(mockFile.save).toHaveBeenCalled();
      expect(renamed).toBe(mockFile);
    });

    test('rejects empty file name with 400', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId
      };
      File.findById.mockResolvedValue(mockFile);

      await expect(documentService.renameDocument(fileId, userId, '   ')).rejects.toThrow('File name cannot be empty.');
    });
  });

  describe('reprocessDocument', () => {
    test('transitions file to processing and triggers asynchronous processing', async () => {
      const mockFile = {
        _id: fileId,
        uploadedBy: userId,
        processingState: 'failed',
        processingError: 'Previous error',
        save: jest.fn().mockResolvedValue(true)
      };
      File.findById.mockResolvedValue(mockFile);

      const result = await documentService.reprocessDocument(fileId, userId);

      expect(Table.deleteMany).toHaveBeenCalledWith({ fileId, uploadedBy: userId });
      expect(Chunk.deleteMany).toHaveBeenCalledWith({ fileId, uploadedBy: userId });
      expect(mockFile.processingState).toBe('processing');
      expect(mockFile.processingError).toBeNull();
      expect(mockFile.save).toHaveBeenCalled();
      expect(result).toEqual({ success: true, processingState: 'processing' });
    });

    test('rejects reprocess when user is not owner (403)', async () => {
      const differentUser = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        uploadedBy: userId
      };
      File.findById.mockResolvedValue(mockFile);

      await expect(documentService.reprocessDocument(fileId, differentUser)).rejects.toThrow('Unauthorized to reprocess this file.');
    });

    test('rejects reprocess when file does not exist (404)', async () => {
      File.findById.mockResolvedValue(null);

      await expect(documentService.reprocessDocument(fileId, userId)).rejects.toThrow('File not found.');
    });
  });

  describe('reconcileOrphanedFiles', () => {
    test('updates files stuck in processing state to failed', async () => {
      File.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });

      const res = await documentService.reconcileOrphanedFiles();

      expect(File.updateMany).toHaveBeenCalledWith(
        { processingState: 'processing' },
        expect.objectContaining({
          processingState: 'failed',
          processingError: expect.stringContaining('interrupted by a server restart')
        })
      );
      expect(res.modifiedCount).toBe(2);
    });
  });
});

