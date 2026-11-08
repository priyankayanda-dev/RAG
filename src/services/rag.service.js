const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const Chunk = require('../models/Chunk');

let aiClient = null;

function getAIClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
const GENERATION_MODEL = process.env.GENERATION_MODEL || 'gemini-flash-lite-latest';

/**
 * Generates an embedding vector for a single text string.
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const ai = getAIClient();
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { outputDimensionality: 768 },
  });

  if (response.embeddings && response.embeddings.length > 0) {
    return response.embeddings[0].values;
  }
  if (response.embedding && response.embedding.values) {
    return response.embedding.values;
  }
  throw new Error('Failed to generate embedding from Gemini API');
}

/**
 * Generates embeddings for an array of texts in batches to respect free-tier rate limits.
 *
 * @param {string[]} texts
 * @param {number} batchSize
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts, batchSize = 20) {
  const ai = getAIClient();
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: { outputDimensionality: 768 },
    });

    if (response.embeddings && response.embeddings.length > 0) {
      for (const emb of response.embeddings) {
        allEmbeddings.push(emb.values);
      }
    } else {
      throw new Error('Failed to generate batch embeddings from Gemini API');
    }
  }

  return allEmbeddings;
}

/**
 * Computes cosine similarity between two numeric vectors.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Retrieves the top-K most relevant chunks for a document using MongoDB Atlas $vectorSearch
 * (with automatic fallback to in-memory cosine similarity if Atlas index is not configured or local DB is used).
 *
 * @param {string} documentId
 * @param {number[]} queryVector
 * @param {number} topK
 * @returns {Promise<Array<{ _id: any, content: string, locator: string, chunkIndex: number, score: number }>>}
 */
async function retrieveTopChunks(documentId, queryVector, topK = 5) {
  const docObjectId = new mongoose.Types.ObjectId(documentId);
  const useLocal = process.env.USE_LOCAL_VECTOR_SEARCH === 'true';

  if (!useLocal) {
    try {
      const results = await Chunk.aggregate([
        {
          $vectorSearch: {
            index: process.env.VECTOR_INDEX_NAME || 'vector_index',
            path: 'embedding',
            queryVector: queryVector,
            numCandidates: Math.max(topK * 10, 50),
            limit: topK,
            filter: {
              documentId: docObjectId,
            },
          },
        },
        {
          $project: {
            content: 1,
            locator: 1,
            chunkIndex: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ]);

      if (results && results.length > 0) {
        return results;
      }
    } catch (err) {
      // Fallback to exact cosine similarity calculation if $vectorSearch is unavailable
      // (e.g., running on local MongoDB or before Atlas Vector Search index finishes building)
      console.warn(
        `[RAG] MongoDB $vectorSearch unavailable (${err.message}). Using exact cosine similarity fallback.`
      );
    }
  }

  // Exact Cosine Similarity calculation over document chunks
  const chunks = await Chunk.find({ documentId: docObjectId })
    .select('content locator chunkIndex embedding')
    .lean();

  const scored = chunks.map((chunk) => ({
    _id: chunk._id,
    content: chunk.content,
    locator: chunk.locator,
    chunkIndex: chunk.chunkIndex,
    score: cosineSimilarity(queryVector, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Full RAG Question-Answering pipeline with "Not Found" Guardrail and Source Citations.
 *
 * @param {string} documentId
 * @param {string} question
 * @returns {Promise<{
 *   answer: string,
 *   citations: Array<{ locator: string, score: number, snippet: string }>,
 *   topScore: number,
 *   guardrailTriggered: boolean
 * }>}
 */
async function answerQuestion(documentId, question) {
  const threshold = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.60');
  const queryVector = await embedText(question);
  const topChunks = await retrieveTopChunks(documentId, queryVector, 5);

  if (!topChunks || topChunks.length === 0) {
    return {
      answer: "I couldn't find this in the document.",
      citations: [],
      topScore: 0,
      guardrailTriggered: true,
    };
  }

  const bestScore = topChunks[0].score;

  // "Not Found" Guardrail: if best similarity score is below threshold, do not guess
  if (bestScore < threshold) {
    return {
      answer: "I couldn't find this in the document.",
      citations: [],
      topScore: Number(bestScore.toFixed(4)),
      guardrailTriggered: true,
    };
  }

  // Format context with explicit source locators
  const contextBlocks = topChunks
    .map(
      (chunk, idx) =>
        `--- CHUNK ${idx + 1} | Citation: [${chunk.locator}] (Similarity: ${chunk.score.toFixed(3)}) ---\n${chunk.content}`
    )
    .join('\n\n');

  const systemInstruction = `You are a precise document Q&A assistant.
Answer the user's question using ONLY the provided context chunks.
Rules:
1. Do NOT use any outside knowledge or make assumptions beyond the context.
2. Every factual statement or figure in your answer MUST include its citation in brackets, e.g., [Page 4] or [Section: Overview].
3. If the provided context chunks do not contain the answer to the question, respond with: "I couldn't find this in the document."`;

  const prompt = `Context Chunks:\n${contextBlocks}\n\nQuestion: ${question}\n\nAnswer (with citations):`;

  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.1,
    },
  });

  const answerText = (response.text || '').trim() || "I couldn't find this in the document.";

  const citations = topChunks.map((c) => ({
    locator: c.locator,
    score: Number(c.score.toFixed(4)),
    snippet: c.content.length > 200 ? c.content.slice(0, 200) + '...' : c.content,
  }));

  return {
    answer: answerText,
    citations,
    topScore: Number(bestScore.toFixed(4)),
    guardrailTriggered: false,
  };
}

module.exports = {
  embedText,
  embedBatch,
  cosineSimilarity,
  retrieveTopChunks,
  answerQuestion,
};
