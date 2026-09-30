const mongoose = require('mongoose');
const Chunk = require('../models/chunks.model');

describe('Chunk Model Schema Validation (Feature A1)', () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const dummyFileId = new mongoose.Types.ObjectId();
  const dummy768Embedding = new Array(768).fill(0.015);

  test('creates a valid chunk instance with correct types and timestamps', () => {
    const chunk = new Chunk({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 3,
      chunkIndex: 0,
      text: 'Section 4.1: The waiting period for pre-existing conditions shall be 24 months of continuous coverage.',
      charLength: 104,
      embedding: dummy768Embedding,
    });

    const validationError = chunk.validateSync();
    expect(validationError).toBeUndefined();
    expect(chunk.fileId).toEqual(dummyFileId);
    expect(chunk.uploadedBy).toEqual(dummyUserId);
    expect(chunk.pageNumber).toBe(3);
    expect(chunk.chunkIndex).toBe(0);
    expect(chunk.text).toContain('waiting period for pre-existing conditions');
    expect(chunk.charLength).toBe(104);
    expect(chunk.embedding).toHaveLength(768);
    expect(chunk.createdAt).toBeInstanceOf(Date);
  });

  test('enforces required fields (fileId, uploadedBy, pageNumber, chunkIndex, text, charLength, embedding)', () => {
    const chunk = new Chunk({});
    const error = chunk.validateSync();

    expect(error).toBeDefined();
    expect(error.errors.fileId).toBeDefined();
    expect(error.errors.uploadedBy).toBeDefined();
    expect(error.errors.pageNumber).toBeDefined();
    expect(error.errors.chunkIndex).toBeDefined();
    expect(error.errors.text).toBeDefined();
    expect(error.errors.charLength).toBeDefined();
    expect(error.errors.embedding).toBeDefined();
  });

  test('rejects empty embedding array', () => {
    const chunk = new Chunk({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Sample passage text',
      charLength: 19,
      embedding: [],
    });

    const error = chunk.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.embedding).toBeDefined();
  });

  test('enforces positive pageNumber and non-negative chunkIndex and charLength', () => {
    const chunk = new Chunk({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 0, // min is 1
      chunkIndex: -1, // min is 0
      text: 'Invalid bounds test',
      charLength: -10, // min is 0
      embedding: [0.1, 0.2],
    });

    const error = chunk.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.pageNumber).toBeDefined();
    expect(error.errors.chunkIndex).toBeDefined();
    expect(error.errors.charLength).toBeDefined();
  });

  test('trims whitespace from text field', () => {
    const chunk = new Chunk({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 1,
      chunkIndex: 0,
      text: '   Padded text content   ',
      charLength: 19,
      embedding: [0.5],
    });

    expect(chunk.text).toBe('Padded text content');
  });

  test('defines required compound indexes for tenant isolation and chunk ordering', () => {
    const indexes = Chunk.schema.indexes();
    const hasTenantFilePageIndex = indexes.some(
      ([idxDef]) => idxDef.uploadedBy === 1 && idxDef.fileId === 1 && idxDef.pageNumber === 1
    );
    const hasFileChunkIndex = indexes.some(
      ([idxDef]) => idxDef.fileId === 1 && idxDef.chunkIndex === 1
    );

    expect(hasTenantFilePageIndex).toBe(true);
    expect(hasFileChunkIndex).toBe(true);
  });
});
