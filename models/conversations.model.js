const mongoose = require('mongoose');

/**
 * Conversation Schema.
 * Tracks multi-turn conversational sessions for one or multiple policy files.
 *
 * Research Principles:
 * - Strict User Isolation: uploadedBy scoped to req.user._id.
 * - Multi-Document Flexibility: fileIds array supports single and multi-document threads.
 */
const conversationSchema = new mongoose.Schema({
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  fileIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File',
    },
  ],
  title: {
    type: String,
    default: 'Policy Inquiry',
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  isArchived: {
    type: Boolean,
    default: false,
  },
});

conversationSchema.index({ uploadedBy: 1, updatedAt: -1 });

/**
 * Message Schema.
 * Represents a single turn (user or model) within a conversation,
 * including FACTUM verified citations and tabular references.
 */
const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },
  sender: {
    type: String,
    enum: ['user', 'model'],
    required: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
  },
  citations: [
    {
      documentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File',
      },
      documentName: {
        type: String,
        trim: true,
      },
      pageNumber: {
        type: Number,
      },
      excerpt: {
        type: String,
        trim: true,
      },
      clauseTitle: {
        type: String,
        trim: true,
      },
      verified: {
        type: Boolean,
        default: false,
      },
    },
  ],
  tablesCited: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

messageSchema.index({ conversationId: 1, createdAt: 1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);

module.exports = {
  Conversation,
  Message,
};
