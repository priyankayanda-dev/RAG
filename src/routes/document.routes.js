const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const { parsePdfBuffer, parseWebsiteUrl, parseRawText } = require('../services/parser.service');
const { chunkSegments } = require('../services/chunker.service');
const { embedBatch, answerQuestion } = require('../services/rag.service');

const router = express.Router();

// Store uploaded PDF in memory (max 15MB) so no paid disk/S3 storage is needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed for file uploads'));
    }
  },
});


/**
 * GET /documents
 * Lists all ingested documents (most recent first)
 */
router.get('/', async (_req, res) => {
  try {
    const docs = await Document.find().sort({ createdAt: -1 }).limit(50).lean();
    return res.json(
      docs.map((doc) => ({
        documentId: doc._id,
        title: doc.title,
        sourceType: doc.sourceType,
        sourceUrl: doc.sourceUrl,
        status: doc.status,
        totalChunks: doc.totalChunks,
        createdAt: doc.createdAt,
      }))
    );
  } catch (error) {
    console.error('[GET /documents] Error:', error);
    return res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * POST /documents
 * Accepts ANY of the 3 sources:
 * 1) PDF upload via multipart/form-data (`file` field)
 * 2) Website URL via JSON or form-data (`url` field)
 * 3) Raw Text via JSON or form-data (`text` field, optional `title`)
 */
router.post('/', upload.single('file'), async (req, res) => {
  let docRecord = null;

  try {
    const file = req.file;
    const { url, text, title } = req.body || {};

    if (!file && !url && !text) {
      return res.status(400).json({
        error: 'Please provide a PDF file (`file`), a website URL (`url`), or raw text (`text`).',
      });
    }

    let sourceType;
    let docTitle;
    let segments = [];

    if (file) {
      sourceType = 'pdf';
      docTitle = title || file.originalname || 'Uploaded PDF';
      docRecord = await Document.create({
        title: docTitle,
        sourceType,
        status: 'processing',
      });

      const parsed = await parsePdfBuffer(file.buffer);
      segments = parsed.segments;
    } else if (url) {
      sourceType = 'url';
      docRecord = await Document.create({
        title: title || url,
        sourceType,
        sourceUrl: url,
        status: 'processing',
      });

      const parsed = await parseWebsiteUrl(url);
      if (!title && parsed.title) {
        docRecord.title = parsed.title;
      }
      segments = parsed.segments;
    } else {
      sourceType = 'text';
      docTitle = title || 'Raw Text Document';
      docRecord = await Document.create({
        title: docTitle,
        sourceType,
        status: 'processing',
      });

      segments = parseRawText(text);
    }

    // Split segments into ~800 character chunks with 150 character overlap
    const rawChunks = chunkSegments(segments, 800, 150);

    if (rawChunks.length === 0) {
      docRecord.status = 'failed';
      docRecord.errorMessage = 'No extractable text found in source';
      await docRecord.save();
      return res.status(422).json({
        error: 'Could not extract any readable text chunks from the provided source.',
        documentId: docRecord._id,
      });
    }

    // Embed all chunks in batches
    const textsToEmbed = rawChunks.map((c) => c.content);
    const embeddings = await embedBatch(textsToEmbed);

    // Prepare and store chunk documents in MongoDB
    const chunkDocs = rawChunks.map((c, idx) => ({
      documentId: docRecord._id,
      content: c.content,
      locator: c.locator,
      chunkIndex: c.chunkIndex,
      embedding: embeddings[idx],
    }));

    await Chunk.insertMany(chunkDocs);

    docRecord.status = 'ready';
    docRecord.totalChunks = chunkDocs.length;
    await docRecord.save();

    return res.status(201).json({
      documentId: docRecord._id,
      title: docRecord.title,
      sourceType: docRecord.sourceType,
      sourceUrl: docRecord.sourceUrl,
      status: docRecord.status,
      totalChunks: docRecord.totalChunks,
      createdAt: docRecord.createdAt,
    });
  } catch (error) {
    console.error('[POST /documents] Error:', error);
    if (docRecord) {
      docRecord.status = 'failed';
      docRecord.errorMessage = error.message;
      await docRecord.save().catch(() => {});
    }
    return res.status(500).json({
      error: error.message || 'Failed to ingest document',
      documentId: docRecord ? docRecord._id : null,
    });
  }
});

/**
 * GET /documents/:id
 * Returns the processing status and metadata of a document
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid document ID format' });
    }

    const doc = await Document.findById(id).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    return res.json({
      documentId: doc._id,
      title: doc.title,
      sourceType: doc.sourceType,
      sourceUrl: doc.sourceUrl,
      status: doc.status,
      totalChunks: doc.totalChunks,
      errorMessage: doc.errorMessage,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    console.error('[GET /documents/:id] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch document status' });
  }
});

/**
 * GET /documents/:id/chunks
 * Returns the chunks for a document (excluding heavy embeddings) for inspection/preview
 */
router.get('/:id/chunks', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid document ID format' });
    }
    const chunks = await Chunk.find({ documentId: id })
      .select('content locator chunkIndex createdAt')
      .sort({ chunkIndex: 1 })
      .lean();
    return res.json({ documentId: id, total: chunks.length, chunks });
  } catch (error) {
    console.error('[GET /documents/:id/chunks] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch chunks' });
  }
});

/**
 * DELETE /documents/:id
 * Deletes a document and all its associated chunks
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid document ID format' });
    }
    await Chunk.deleteMany({ documentId: id });
    const deleted = await Document.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.json({ success: true, message: 'Document and chunks deleted successfully' });
  } catch (error) {
    console.error('[DELETE /documents/:id] Error:', error);
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * POST /documents/:id/ask
 * Embeds the user's question, fetches top-5 chunks by cosine similarity,
 * checks the "Not Found" guardrail threshold, and queries Gemini with citation enforcement.
 */
router.post('/:id/ask', async (req, res) => {
  try {
    const { id } = req.params;
    const { question } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid document ID format' });
    }

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Please provide a non-empty `question` string.' });
    }

    const doc = await Document.findById(id).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.status !== 'ready') {
      return res.status(409).json({
        error: `Document is currently '${doc.status}' and not ready for Q&A.`,
        status: doc.status,
      });
    }

    const result = await answerQuestion(id, question.trim());

    return res.json({
      documentId: doc._id,
      documentTitle: doc.title,
      sourceType: doc.sourceType,
      question: question.trim(),
      answer: result.answer,
      citations: result.citations,
      topScore: result.topScore,
      guardrailTriggered: result.guardrailTriggered,
    });
  } catch (error) {
    console.error('[POST /documents/:id/ask] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to answer question',
    });
  }
});

module.exports = router;
