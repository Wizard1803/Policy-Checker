const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
    required: true,
    index: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  pageNumber: {
    type: Number,
    required: true,
    min: 1,
  },
  tableIndex: {
    type: Number,
    required: true,
    min: 0,
  },
  title: {
    type: String,
    default: 'Document Table',
    trim: true,
  },
  headers: [{
    type: String,
    trim: true,
  }],
  rows: [[{
    type: String,
    trim: true,
  }]],
  markdownRepresentation: {
    type: String,
    required: true,
  },
  extractionStatus: {
    type: String,
    enum: ['success', 'warning', 'failed'],
    default: 'success',
    index: true,
  },
  extractionConfidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 1.0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound indexes for user-isolated queries and ordered retrieval
tableSchema.index({ uploadedBy: 1, fileId: 1 });
tableSchema.index({ fileId: 1, pageNumber: 1, tableIndex: 1 });

module.exports = mongoose.model('Table', tableSchema);
