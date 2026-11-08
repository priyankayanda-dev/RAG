# OmniCite — Multi-Source RAG Q&A API

A zero-cost, production-ready Retrieval-Augmented Generation (RAG) API built with **Node.js, Express, MongoDB, and Google Gemini**.
Supports ingesting **PDFs, Websites (URLs), and Raw Text**, splitting into 800-character overlapping chunks with source/page citations, vector retrieval, and a "Not Found" similarity guardrail.

---

## Features

1. **Multi-Source Ingestion (`POST /documents`)**
   - **PDF Files:** Extracts text per page and tags chunks with `Page X`.
   - **Websites (URL):** Scrapes readable sections/headings via `cheerio` and tags chunks with `Section: <Heading> (<domain>)`.
   - **Raw Text:** Supports explicit `[Page X]` markers or automatic sectioning.
2. **800-Character Chunking with 150-Character Overlap**
   - Sentence-aware sliding window chunker (`src/services/chunker.service.js`).
3. **MongoDB Vector Search + Automatic Local Fallback**
   - Uses MongoDB Atlas `$vectorSearch` index in production and automatically falls back to exact cosine similarity if running locally or before the Atlas index is created.
4. **"Not Found" Similarity Guardrail (`POST /documents/:id/ask`)**
   - If the top chunk's cosine similarity is below `SIMILARITY_THRESHOLD` (default `0.60`), immediately returns `"I couldn't find this in the document."` without hallucinating.

---

## Quick Start

### 1. Install Dependencies
```bash
cd omnicite-rag-api
npm install
```

### 2. Configure Environment Variables
Create a `.env` file inside `omnicite-rag-api/`:
```ini
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.example.mongodb.net/rag_lite?retryWrites=true&w=majority
GEMINI_API_KEY=your_free_gemini_api_key
SIMILARITY_THRESHOLD=0.60
USE_LOCAL_VECTOR_SEARCH=false
```
* **Free MongoDB:** Create a free M0 cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
* **Free Gemini Key:** Get a free API key at [Google AI Studio](https://aistudio.google.com/apikey).

### 3. (Optional) Create MongoDB Atlas Vector Search Index
In MongoDB Atlas -> **Atlas Search** -> **Create Search Index** -> **Atlas Vector Search (JSON Editor)** on database `rag_lite`, collection `chunks`, index name `vector_index`:
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "documentId"
    }
  ]
}
```
*(Note: Even if you skip this step, the API automatically falls back to exact in-memory cosine similarity over the document's chunks!)*

### 4. Start the Server & Launch Web UI
```bash
npm start
```
Once started, open **`http://localhost:9000`** (or your configured `PORT`) in your browser to access the **OmniCite RAG Studio Web Interface**!

The web UI provides:
- **Interactive Multi-Source Ingestion:** Drag-and-drop PDF uploader, Website URL scraper, and Raw Text editor with instant benchmark samples.
- **Knowledge Base Library:** View, search, inspect chunks, and delete ingested documents.
- **Grounded Q&A Chat:** Conversational workspace powered by Gemini with clickable citation badges (`[Page X]` or `[Section: Y]`).
- **Retrieved Chunks Inspector:** Accordion revealing the top-5 retrieved context chunks with their exact cosine similarity scores.
- **Similarity Guardrail Visualization:** Alerts when similarity is below the 0.60 threshold to guarantee zero hallucinations.

---

## API Usage Examples

### 1A. Upload a PDF (`POST /documents`)
```bash
curl -X POST http://localhost:3000/documents \
  -F "file=@/path/to/earnings-release.pdf" \
  -F "title=Q3 Earnings PDF"
```

### 1B. Ingest Any Website URL (`POST /documents`)
```bash
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://en.wikipedia.org/wiki/Retrieval-augmented_generation"
  }'
```

### 1C. Ingest Raw Text (`POST /documents`)
```bash
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q3 Filing Notes",
    "text": "[Page 1] Total Q3 revenue was $482.5M, up 24% YoY. [Page 2] GAAP operating income was $64.2M."
  }'
```

### 2. Check Document Status (`GET /documents/:id`)
```bash
curl http://localhost:3000/documents/<documentId>
```

### 3. Ask a Question with Citations (`POST /documents/:id/ask`)
```bash
curl -X POST http://localhost:3000/documents/<documentId>/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What was the total Q3 revenue and YoY growth?"
  }'
```
