require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const documentRoutes = require('./routes/document.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint (useful for Render / Koyeb free tier health checks)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'omnicite-rag-api',
    model: process.env.GENERATION_MODEL || 'gemini-flash-lite-latest',
  });
});

// Core RAG API routes
app.use('/documents', documentRoutes);

// Global error handler (e.g., Multer file size/type errors)
app.use((err, _req, res, _next) => {
  console.error('[GlobalError]', err.message);
  res.status(400).json({ error: err.message || 'Bad request' });
});

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`OmniCite RAG API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
