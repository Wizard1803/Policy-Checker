const mongoose = require('mongoose');
const Table = require('../models/tables.model');

describe('Table Model Schema Validation (Phase 1)', () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const dummyFileId = new mongoose.Types.ObjectId();

  test('creates a valid table instance with correct defaults', () => {
    const table = new Table({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 1,
      tableIndex: 0,
      markdownRepresentation: '| Col 1 |\n| --- |\n| Val 1 |'
    });

    const validationError = table.validateSync();
    expect(validationError).toBeUndefined();
    expect(table.title).toBe('Document Table');
    expect(table.extractionStatus).toBe('success');
    expect(table.extractionConfidence).toBe(1.0);
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
    expect(table.createdAt).toBeInstanceOf(Date);
  });

  test('enforces required fields (fileId, uploadedBy, pageNumber, tableIndex, markdownRepresentation)', () => {
    const table = new Table({});
    const error = table.validateSync();

    expect(error).toBeDefined();
    expect(error.errors.fileId).toBeDefined();
    expect(error.errors.uploadedBy).toBeDefined();
    expect(error.errors.pageNumber).toBeDefined();
    expect(error.errors.tableIndex).toBeDefined();
    expect(error.errors.markdownRepresentation).toBeDefined();
  });

  test('validates extractionStatus enum strictly', () => {
    const validStatuses = ['success', 'warning', 'failed'];
    for (const status of validStatuses) {
      const table = new Table({
        fileId: dummyFileId,
        uploadedBy: dummyUserId,
        pageNumber: 1,
        tableIndex: 0,
        markdownRepresentation: '| A |',
        extractionStatus: status
      });
      expect(table.validateSync()).toBeUndefined();
    }

    const invalidTable = new Table({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 1,
      tableIndex: 0,
      markdownRepresentation: '| A |',
      extractionStatus: 'invalid_status'
    });
    const error = invalidTable.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.extractionStatus).toBeDefined();
    expect(error.errors.extractionStatus.kind).toBe('enum');
  });

  test('enforces min constraints on pageNumber (min 1) and tableIndex (min 0)', () => {
    const invalidTable = new Table({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 0, // must be >= 1
      tableIndex: -1, // must be >= 0
      markdownRepresentation: '| A |'
    });

    const error = invalidTable.validateSync();
    expect(error).toBeDefined();
    expect(error.errors.pageNumber).toBeDefined();
    expect(error.errors.tableIndex).toBeDefined();
  });

  test('enforces extractionConfidence range between 0 and 1', () => {
    const tooLow = new Table({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 1,
      tableIndex: 0,
      markdownRepresentation: '| A |',
      extractionConfidence: -0.5
    });
    expect(tooLow.validateSync()?.errors.extractionConfidence).toBeDefined();

    const tooHigh = new Table({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 1,
      tableIndex: 0,
      markdownRepresentation: '| A |',
      extractionConfidence: 1.5
    });
    expect(tooHigh.validateSync()?.errors.extractionConfidence).toBeDefined();

    const validConfidence = new Table({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 1,
      tableIndex: 0,
      markdownRepresentation: '| A |',
      extractionConfidence: 0.7
    });
    expect(validConfidence.validateSync()).toBeUndefined();
  });

  test('persists 2D array of rows and headers', () => {
    const table = new Table({
      fileId: dummyFileId,
      uploadedBy: dummyUserId,
      pageNumber: 3,
      tableIndex: 1,
      title: 'Room Rent Limits',
      headers: ['Plan', 'Limit'],
      rows: [
        ['Silver', '1%'],
        ['Gold', 'Single Room']
      ],
      markdownRepresentation: '| Plan | Limit |\n| --- | --- |\n| Silver | 1% |\n| Gold | Single Room |'
    });

    expect(table.validateSync()).toBeUndefined();
    expect(table.headers).toEqual(['Plan', 'Limit']);
    expect(table.rows.length).toBe(2);
    expect(table.rows[0]).toEqual(['Silver', '1%']);
    expect(table.rows[1]).toEqual(['Gold', 'Single Room']);
  });

  test('configures compound indexes for user isolation and page ordering', () => {
    const indexes = Table.schema.indexes();
    const indexFields = indexes.map((idx) => idx[0]);

    const hasUserIsolationIndex = indexFields.some(
      (fields) => fields.uploadedBy === 1 && fields.fileId === 1
    );
    const hasOrderingIndex = indexFields.some(
      (fields) => fields.fileId === 1 && fields.pageNumber === 1 && fields.tableIndex === 1
    );

    expect(hasUserIsolationIndex).toBe(true);
    expect(hasOrderingIndex).toBe(true);
  });
});
