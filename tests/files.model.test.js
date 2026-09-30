const mongoose = require('mongoose');
const File = require('../models/files.model');

describe('File Model Schema Validation (models/files.model.js)', () => {
  const dummyUserId = new mongoose.Types.ObjectId();

  test('creates a valid file instance with correct defaults', () => {
    const file = new File({
      fileName: 'test-policy.pdf',
      fileUrl: 'https://res.cloudinary.com/demo/image/upload/test-policy.pdf',
      cloudinaryPublicId: 'policies/123/test-policy',
      cloudinaryVersion: 1,
      uploadedBy: dummyUserId
    });

    const validationError = file.validateSync();
    expect(validationError).toBeUndefined();
    expect(file.processingState).toBe('uploaded');
    expect(file.pageCount).toBe(0);
    expect(file.fileSizeBytes).toBe(0);
    expect(file.processingError).toBeNull();
    expect(file.processedAt).toBeNull();
    expect(file.extractedText).toBe('');
    expect(file.uploadedAt).toBeInstanceOf(Date);
  });

  test('enforces required fields (fileName, fileUrl, uploadedBy)', () => {
    const file = new File({});
    const validationError = file.validateSync();
    expect(validationError).toBeDefined();
    expect(validationError.errors.fileName).toBeDefined();
    expect(validationError.errors.fileUrl).toBeDefined();
    expect(validationError.errors.uploadedBy).toBeDefined();
  });

  test('validates processingState enum values strictly', () => {
    const validStates = ['uploaded', 'processing', 'ready', 'failed'];
    for (const state of validStates) {
      const file = new File({
        fileName: 'valid.pdf',
        fileUrl: 'https://example.com/valid.pdf',
        uploadedBy: dummyUserId,
        processingState: state
      });
      expect(file.validateSync()).toBeUndefined();
    }

    const invalidFile = new File({
      fileName: 'invalid.pdf',
      fileUrl: 'https://example.com/invalid.pdf',
      uploadedBy: dummyUserId,
      processingState: 'unknown_state'
    });
    const error = invalidFile.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.processingState).toBeDefined();
    expect(error.errors.processingState.kind).toBe('enum');
  });

  test('enforces non-negative pageCount and fileSizeBytes', () => {
    const file = new File({
      fileName: 'negative.pdf',
      fileUrl: 'https://example.com/negative.pdf',
      uploadedBy: dummyUserId,
      pageCount: -5,
      fileSizeBytes: -100
    });

    const error = file.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.pageCount).toBeDefined();
    expect(error.errors.fileSizeBytes).toBeDefined();
  });

  test('trims whitespace from fileName', () => {
    const file = new File({
      fileName: '   trimmed-policy.pdf   ',
      fileUrl: 'https://example.com/trimmed.pdf',
      uploadedBy: dummyUserId
    });

    expect(file.fileName).toBe('trimmed-policy.pdf');
  });
});
