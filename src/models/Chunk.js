const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    locator: {
      type: String,
      required: true, // e.g., "Page 3", "Section: Overview", "Part 1"
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Chunk', chunkSchema);
