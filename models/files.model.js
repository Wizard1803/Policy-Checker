const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  cloudinaryPublicId: {
    type: String,
    required: false
  },
  cloudinaryVersion: {
    type: Number,
    required: false
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },

  // Phase 2 Lifecycle State Machine
  processingState: {
    type: String,
    enum: ['uploaded', 'processing', 'ready', 'failed'],
    default: 'uploaded',
    index: true
  },
  processingError: {
    type: String,
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  },
  pageCount: {
    type: Number,
    default: 0,
    min: 0
  },
  fileSizeBytes: {
    type: Number,
    default: 0,
    min: 0
  },

  // Cached full extracted text (select: false ensures standard listings remain fast)
  extractedText: {
    type: String,
    default: '',
    select: false
  },

  // Cached actuarial summary (select: false keeps file list queries lean)
  actuarialSummary: {
    type: Object,
    default: null,
    select: false
  }
});

// Compound index for fast user dashboard listing
fileSchema.index({ uploadedBy: 1, uploadedAt: -1 });

const File = mongoose.model('File', fileSchema);

module.exports = File;