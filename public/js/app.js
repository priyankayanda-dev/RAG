/**
 * OmniCite RAG Studio — Frontend Controller
 */

// Application State
let documents = [];
let activeDocumentId = null;
let activeDocument = null;
let currentTab = 'pdf';
let selectedPdfFile = null;
let currentModalChunks = [];
let isAsking = false;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();
  checkHealth();
  fetchDocuments();
  setInterval(checkHealth, 20000); // Live health check every 20s
});

/**
 * Health check monitor
 */
async function checkHealth() {
  const badge = document.getElementById('systemHealthBadge');
  const text = document.getElementById('systemHealthText');
  const modelBadge = document.getElementById('modelNameBadge');
  try {
    const res = await fetch('/health');
    if (res.ok) {
      const data = await res.json();
      badge.className = 'flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium';
      text.innerText = 'API Connected';
      if (modelBadge && data.model) {
        modelBadge.innerText = data.model;
      }
    } else {
      throw new Error();
    }
  } catch (e) {
    badge.className = 'flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium';
    text.innerText = 'API Offline';
  }
}

/**
 * Switch Ingestion Tab (PDF / URL / Text)
 */
function switchIngestTab(tab) {
  currentTab = tab;
  const pdfBtn = document.getElementById('tabPdfBtn');
  const urlBtn = document.getElementById('tabUrlBtn');
  const textBtn = document.getElementById('tabTextBtn');

  const formPdf = document.getElementById('formPdf');
  const formUrl = document.getElementById('formUrl');
  const formText = document.getElementById('formText');

  const activeClasses = 'bg-brand-600 text-white shadow-sm';
  const inactiveClasses = 'text-slate-400 hover:text-slate-200';

  [pdfBtn, urlBtn, textBtn].forEach(btn => {
    btn.className = `py-2 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${inactiveClasses}`;
  });

  formPdf.classList.add('hidden');
  formUrl.classList.add('hidden');
  formText.classList.add('hidden');

  if (tab === 'pdf') {
    pdfBtn.className = `py-2 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${activeClasses}`;
    formPdf.classList.remove('hidden');
  } else if (tab === 'url') {
    urlBtn.className = `py-2 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${activeClasses}`;
    formUrl.classList.remove('hidden');
  } else {
    textBtn.className = `py-2 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${activeClasses}`;
    formText.classList.remove('hidden');
  }
}

/**
 * PDF Dropzone & File selection
 */
function setupDropzone() {
  const dropzone = document.getElementById('pdfDropzone');
  const fileInput = document.getElementById('pdfFileInput');

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (files[0].type === 'application/pdf' || files[0].name.toLowerCase().endsWith('.pdf')) {
        setPdfFile(files[0]);
      } else {
        showToast('Please upload a valid .pdf file', 'error');
      }
    }
  });
}

function handlePdfFileChange(input) {
  if (input.files && input.files[0]) {
    setPdfFile(input.files[0]);
  }
}

function setPdfFile(file) {
  selectedPdfFile = file;
  document.getElementById('pdfEmptyState').classList.add('hidden');
  document.getElementById('pdfFilePreview').classList.remove('hidden');
  document.getElementById('pdfFileName').innerText = file.name;
  
  const sizeKb = (file.size / 1024).toFixed(1);
  const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
  document.getElementById('pdfFileSize').innerText = file.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

  const titleInput = document.getElementById('pdfTitleInput');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^/.]+$/, "");
  }
}

function clearPdfFile(e) {
  if (e) e.stopPropagation();
  selectedPdfFile = null;
  document.getElementById('pdfFileInput').value = '';
  document.getElementById('pdfEmptyState').classList.remove('hidden');
  document.getElementById('pdfFilePreview').classList.add('hidden');
}

/**
 * Handle PDF Submit
 */
async function handlePdfSubmit(event) {
  event.preventDefault();
  if (!selectedPdfFile) {
    showToast('Please select or drop a PDF file first', 'error');
    return;
  }

  const title = document.getElementById('pdfTitleInput').value.trim();
  const formData = new FormData();
  formData.append('file', selectedPdfFile);
  if (title) formData.append('title', title);

  const btn = document.getElementById('pdfSubmitBtn');
  const btnText = document.getElementById('pdfBtnText');
  const spinner = document.getElementById('pdfSpinner');

  setLoading(btn, btnText, spinner, true, 'Parsing & Vectorizing PDF...');

  try {
    const res = await fetch('/documents', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to ingest PDF');
    }

    showToast(`PDF indexed! Extracted ${data.totalChunks} chunks.`, 'success');
    clearPdfFile();
    document.getElementById('pdfTitleInput').value = '';

    await fetchDocuments();
    if (data.documentId) {
      selectDocument(data.documentId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(btn, btnText, spinner, false, 'Index & Vectorize PDF');
  }
}

/**
 * Handle URL Submit
 */
async function handleUrlSubmit(event) {
  event.preventDefault();
  const url = document.getElementById('urlInput').value.trim();
  const title = document.getElementById('urlTitleInput').value.trim();

  if (!url) {
    showToast('Please enter a valid website URL', 'error');
    return;
  }

  const btn = document.getElementById('urlSubmitBtn');
  const btnText = document.getElementById('urlBtnText');
  const spinner = document.getElementById('urlSpinner');

  setLoading(btn, btnText, spinner, true, 'Scraping & Vectorizing...');

  try {
    const res = await fetch('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title: title || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to ingest URL');
    }

    showToast(`Website indexed! Extracted ${data.totalChunks} chunks.`, 'success');
    document.getElementById('urlInput').value = '';
    document.getElementById('urlTitleInput').value = '';

    await fetchDocuments();
    if (data.documentId) {
      selectDocument(data.documentId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(btn, btnText, spinner, false, 'Scrape & Index Webpage');
  }
}

/**
 * Handle Raw Text Submit
 */
async function handleTextSubmit(event) {
  event.preventDefault();
  const text = document.getElementById('rawTextInput').value.trim();
  const title = document.getElementById('rawTextTitleInput').value.trim() || 'Raw Text Document';

  if (!text) {
    showToast('Please paste text content', 'error');
    return;
  }

  const btn = document.getElementById('textSubmitBtn');
  const btnText = document.getElementById('textBtnText');
  const spinner = document.getElementById('textSpinner');

  setLoading(btn, btnText, spinner, true, 'Chunking & Vectorizing...');

  try {
    const res = await fetch('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to ingest text');
    }

    showToast(`Text document indexed! Extracted ${data.totalChunks} chunks.`, 'success');
    document.getElementById('rawTextInput').value = '';
    document.getElementById('rawTextTitleInput').value = '';

    await fetchDocuments();
    if (data.documentId) {
      selectDocument(data.documentId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(btn, btnText, spinner, false, 'Index & Vectorize Text');
  }
}

/**
 * Fetch and render documents list
 */
async function fetchDocuments() {
  const container = document.getElementById('documentsList');
  const badge = document.getElementById('docCountBadge');

  try {
    const res = await fetch('/documents');
    if (!res.ok) throw new Error('Failed to retrieve documents');
    documents = await res.json();

    badge.innerText = documents.length;

    if (documents.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 px-4 text-slate-500 space-y-2">
          <div class="w-10 h-10 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-400">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p class="text-xs font-medium text-slate-400">No documents indexed yet</p>
          <p class="text-[11px] text-slate-500">Upload a PDF, ingest a URL, or paste text above to start building your knowledge base.</p>
        </div>
      `;
      return;
    }

    renderDocuments(documents);

    // If an active document was selected previously, re-verify it still exists
    if (activeDocumentId) {
      const stillExists = documents.find(d => d.documentId === activeDocumentId);
      if (stillExists) {
        selectDocument(activeDocumentId, false);
      } else {
        selectDocument(documents[0].documentId);
      }
    } else if (documents.length > 0) {
      selectDocument(documents[0].documentId);
    }
  } catch (err) {
    container.innerHTML = `
      <div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
        Failed to load documents: ${err.message}
      </div>
    `;
  }
}

/**
 * Filter documents in sidebar search
 */
function filterDocuments() {
  const query = document.getElementById('docSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderDocuments(documents);
    return;
  }
  const filtered = documents.filter(doc => 
    (doc.title && doc.title.toLowerCase().includes(query)) ||
    (doc.sourceType && doc.sourceType.toLowerCase().includes(query)) ||
    (doc.sourceUrl && doc.sourceUrl.toLowerCase().includes(query))
  );
  renderDocuments(filtered);
}

/**
 * Render document cards
 */
function renderDocuments(docsList) {
  const container = document.getElementById('documentsList');

  if (docsList.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-500 text-xs">
        No documents match your filter.
      </div>
    `;
    return;
  }

  container.innerHTML = docsList.map(doc => {
    const isActive = doc.documentId === activeDocumentId;
    const dateFormatted = new Date(doc.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let sourceBadge = '';
    if (doc.sourceType === 'pdf') {
      sourceBadge = `<span class="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">PDF</span>`;
    } else if (doc.sourceType === 'url') {
      sourceBadge = `<span class="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold">URL</span>`;
    } else {
      sourceBadge = `<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold">TEXT</span>`;
    }

    let statusIndicator = '';
    if (doc.status === 'ready') {
      statusIndicator = `<span class="inline-flex items-center gap-1 text-[10px] text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Ready</span>`;
    } else if (doc.status === 'processing') {
      statusIndicator = `<span class="inline-flex items-center gap-1 text-[10px] text-amber-400"><span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>Processing</span>`;
    } else {
      statusIndicator = `<span class="inline-flex items-center gap-1 text-[10px] text-rose-400"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>Failed</span>`;
    }

    return `
      <div 
        onclick="selectDocument('${doc.documentId}')"
        class="group relative p-3 rounded-xl cursor-pointer transition-all border ${
          isActive 
            ? 'bg-brand-950/40 border-brand-500/80 shadow-md shadow-brand-500/10 ring-1 ring-brand-500/30' 
            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
        }"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 mb-1">
              ${sourceBadge}
              ${statusIndicator}
              <span class="text-[10px] text-slate-500 font-mono ml-auto">${dateFormatted}</span>
            </div>
            <h3 class="text-xs font-semibold text-slate-200 truncate group-hover:text-white" title="${escapeHtml(doc.title)}">
              ${escapeHtml(doc.title)}
            </h3>
            <div class="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
              <span class="font-mono text-slate-400">📦 ${doc.totalChunks || 0} chunks</span>
              ${doc.sourceUrl ? `<span class="truncate max-w-[150px] text-slate-500 text-[10px]">${escapeHtml(doc.sourceUrl)}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Action Row -->
        <div class="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
          <button 
            type="button"
            onclick="event.stopPropagation(); openChunksModal('${doc.documentId}')"
            class="text-brand-400 hover:text-brand-300 font-medium flex items-center gap-1"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Chunks
          </button>

          <div class="flex items-center gap-2">
            ${
              isActive 
                ? '<span class="text-[10px] font-semibold text-brand-300 uppercase tracking-wider bg-brand-500/20 px-2 py-0.5 rounded">Active</span>'
                : `<span class="text-[10px] text-slate-500 group-hover:text-slate-300">Click to Select &rarr;</span>`
            }
            <button 
              type="button"
              onclick="event.stopPropagation(); deleteDocument('${doc.documentId}', event)"
              title="Delete document"
              class="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-colors"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Select active document for Q&A
 */
function selectDocument(docId, clearOldMessages = false) {
  activeDocumentId = docId;
  activeDocument = documents.find(d => d.documentId === docId);

  // Update Top Bar Chip
  const chip = document.getElementById('activeDocChip');
  const chipTitle = document.getElementById('activeDocChipTitle');
  const chipChunks = document.getElementById('activeDocChipChunks');

  // Update Main Workspace Banner
  const bannerIcon = document.getElementById('activeDocSourceIcon');
  const bannerTitle = document.getElementById('activeDocMainTitle');
  const bannerMeta = document.getElementById('activeDocMeta');
  const bannerActions = document.getElementById('activeDocActions');
  const emptyState = document.getElementById('emptyWorkspaceState');
  const suggestedBar = document.getElementById('suggestedQuestionsBar');

  if (!activeDocument) {
    chip.classList.add('hidden');
    bannerTitle.innerHTML = '<span>No Document Selected</span>';
    bannerMeta.innerText = 'Select or ingest a document on the left panel to begin question answering.';
    bannerActions.classList.add('hidden');
    emptyState.classList.remove('hidden');
    suggestedBar.classList.add('hidden');
    return;
  }

  chip.classList.remove('hidden');
  chipTitle.innerText = activeDocument.title;
  chipChunks.innerText = `${activeDocument.totalChunks || 0} chunks`;

  let typeColor = 'bg-brand-500/20 text-brand-400';
  if (activeDocument.sourceType === 'pdf') typeColor = 'bg-rose-500/20 text-rose-400';
  if (activeDocument.sourceType === 'url') typeColor = 'bg-indigo-500/20 text-indigo-400';
  if (activeDocument.sourceType === 'text') typeColor = 'bg-emerald-500/20 text-emerald-400';

  bannerIcon.className = `w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs uppercase ${typeColor}`;
  bannerIcon.innerText = activeDocument.sourceType;

  bannerTitle.innerHTML = `
    <span class="truncate max-w-md">${escapeHtml(activeDocument.title)}</span>
    <span class="text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
      ${activeDocument.totalChunks || 0} chunks
    </span>
  `;
  bannerMeta.innerText = `Ingested on ${new Date(activeDocument.createdAt).toLocaleDateString()} • Ready for vector retrieval & citing`;
  bannerActions.classList.remove('hidden');
  emptyState.classList.add('hidden');
  suggestedBar.classList.remove('hidden');

  // Re-render sidebar to highlight active card
  renderDocuments(documents);

  // Restore or reset chat messages
  if (clearOldMessages) {
    document.getElementById('messagesContainer').innerHTML = '';
  }

  // Welcome assistant greeting if messages empty
  const msgContainer = document.getElementById('messagesContainer');
  if (msgContainer.children.length === 0) {
    appendAssistantWelcome(activeDocument);
  }
}

/**
 * Assistant Welcome Greeting
 */
function appendAssistantWelcome(doc) {
  const container = document.getElementById('messagesContainer');
  const welcomeDiv = document.createElement('div');
  welcomeDiv.className = 'flex items-start gap-3 animate-fade-in';
  welcomeDiv.innerHTML = `
    <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white flex-shrink-0 shadow-md">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </div>
    <div class="flex-1 space-y-2">
      <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 prose-dark text-xs md:text-sm">
        <p>I have ingested <strong>"${escapeHtml(doc.title)}"</strong> into <strong>${doc.totalChunks || 0}</strong> vector-indexed chunks.</p>
        <p class="text-slate-400 mt-1">Ask me any factual question about this document. Every answer will be grounded in the context chunks with exact citation tags ([Page X] or [Section Y]).</p>
      </div>
    </div>
  `;
  container.appendChild(welcomeDiv);
}

/**
 * Delete a document
 */
async function deleteDocument(docId, event) {
  if (event) event.stopPropagation();

  if (!confirm('Are you sure you want to delete this document and all its indexed chunks?')) {
    return;
  }

  try {
    const res = await fetch(`/documents/${docId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete document');

    showToast('Document deleted successfully', 'info');

    if (activeDocumentId === docId) {
      activeDocumentId = null;
      activeDocument = null;
      document.getElementById('messagesContainer').innerHTML = '';
    }

    await fetchDocuments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Handle Asking a Question
 */
async function handleAskSubmit(event) {
  event.preventDefault();
  if (isAsking) return;

  const textarea = document.getElementById('questionInput');
  const question = textarea.value.trim();

  if (!question) return;

  if (!activeDocumentId) {
    showToast('Please select or upload a document first', 'error');
    return;
  }

  // Clear input
  textarea.value = '';
  autoResizeTextarea(textarea);
  document.getElementById('charCount').innerText = '0 characters';

  // 1. Render User Message
  appendUserMessage(question);

  // 2. Render Loading Assistant Bubble
  const loadingId = 'loading-' + Date.now();
  appendLoadingAssistantMessage(loadingId);

  // Set Loading state
  isAsking = true;
  const sendBtn = document.getElementById('sendBtn');
  const sendIcon = document.getElementById('sendIcon');
  const sendSpinner = document.getElementById('sendSpinner');
  sendBtn.disabled = true;
  sendIcon.classList.add('hidden');
  sendSpinner.classList.remove('hidden');

  try {
    const res = await fetch(`/documents/${activeDocumentId}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to get answer');
    }

    // Replace loading placeholder with actual response
    replaceLoadingAssistantMessage(loadingId, data);
  } catch (err) {
    replaceLoadingWithError(loadingId, err.message);
  } finally {
    isAsking = false;
    sendBtn.disabled = false;
    sendIcon.classList.remove('hidden');
    sendSpinner.classList.add('hidden');
    scrollToBottom();
  }
}

/**
 * Ask one of the preset/suggested questions
 */
function askPresetQuestion(text) {
  const textarea = document.getElementById('questionInput');
  textarea.value = text;
  autoResizeTextarea(textarea);
  handleAskSubmit(new Event('submit'));
}

/**
 * Append User Message
 */
function appendUserMessage(text) {
  const container = document.getElementById('messagesContainer');
  const userDiv = document.createElement('div');
  userDiv.className = 'flex items-start justify-end gap-3 animate-fade-in';
  userDiv.innerHTML = `
    <div class="max-w-xl space-y-1 text-right">
      <div class="inline-block px-4 py-2.5 rounded-2xl rounded-tr-sm bg-brand-600 text-white text-xs md:text-sm font-medium shadow-md shadow-brand-600/20 text-left">
        ${escapeHtml(text)}
      </div>
      <p class="text-[10px] text-slate-500 font-mono">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
    </div>
    <div class="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 flex-shrink-0">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  `;
  container.appendChild(userDiv);
  scrollToBottom();
}

/**
 * Append Loading Assistant Skeleton
 */
function appendLoadingAssistantMessage(loadingId) {
  const container = document.getElementById('messagesContainer');
  const loadingDiv = document.createElement('div');
  loadingDiv.id = loadingId;
  loadingDiv.className = 'flex items-start gap-3 animate-fade-in';
  loadingDiv.innerHTML = `
    <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white flex-shrink-0 shadow-md">
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </div>
    <div class="flex-1 max-w-2xl space-y-2">
      <div class="p-4 rounded-2xl rounded-tl-sm bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="flex items-center gap-2 text-xs text-brand-300">
          <span class="w-2 h-2 rounded-full bg-brand-400 animate-pulse"></span>
          <span>Searching vector index &amp; retrieving context chunks...</span>
        </div>
        <div class="h-3 bg-slate-800 rounded w-5/6 animate-pulse"></div>
        <div class="h-3 bg-slate-800 rounded w-4/6 animate-pulse"></div>
      </div>
    </div>
  `;
  container.appendChild(loadingDiv);
  scrollToBottom();
}

/**
 * Replace loading message with answered response
 */
function replaceLoadingAssistantMessage(loadingId, data) {
  const el = document.getElementById(loadingId);
  if (!el) return;

  const rawAnswer = data.answer || "I couldn't find this in the document.";
  const citations = data.citations || [];
  const topScore = data.topScore !== undefined ? data.topScore : null;
  const guardrailTriggered = !!data.guardrailTriggered;

  // Format citations inside answer as interactive clickable chips
  let parsedHtml = marked.parse(rawAnswer);
  parsedHtml = parsedHtml.replace(/(?:\[?\s*↑?\s*(Page\s*\d+|Section:[^\]\n]+|Part\s*\d+)\s*\]?)/gi, (match, p1) => {
    return `<span class="citation-chip" title="Click to view source passage" onclick="highlightCitation('${escapeHtml(p1)}')">📄 ${escapeHtml(p1)}</span>`;
  });

  // Guardrail alert box
  let guardrailBanner = '';
  if (guardrailTriggered) {
    guardrailBanner = `
      <div class="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
        <svg class="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span><strong>Guardrail Triggered:</strong> Top similarity score (${topScore}) is below threshold (0.60). Model refused to hallucinate.</span>
      </div>
    `;
  }

  // Clean, sleek Sources Shelf (compact, collapsed by default)
  let sourcesHtml = '';
  if (citations.length > 0) {
    // Build compact source pills for the top retrieved citations
    const sourceChips = citations.slice(0, 4).map((c, idx) => {
      const escapedSnippet = escapeHtml(c.snippet).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      return `
        <button 
          type="button" 
          onclick="openSourcePreviewModal('${escapeHtml(c.locator)}', '${escapedSnippet}', ${c.score})"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 text-xs font-mono border border-slate-700/60 transition-all hover:border-brand-500/40"
          title="Click to view source snippet"
        >
          <span class="text-brand-400">📄</span>
          <span>${escapeHtml(c.locator)}</span>
          <span class="text-[10px] text-slate-400 font-sans font-medium">#${idx + 1}</span>
        </button>
      `;
    }).join('');

    sourcesHtml = `
      <div class="mt-3.5 pt-3 border-t border-slate-800/80">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] font-medium text-slate-400 mr-1">Sources:</span>
            ${sourceChips}
          </div>
          <button 
            type="button" 
            onclick="toggleDebugChunks('${loadingId}-chunks', this)"
            class="text-[11px] text-brand-400 hover:text-brand-300 font-medium flex items-center gap-1 transition-colors"
          >
            <span>Inspect All Chunks (${citations.length})</span>
            <svg class="w-3 h-3 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        <!-- Collapsible raw chunks list (hidden by default to avoid clutter) -->
        <div id="${loadingId}-chunks" class="hidden mt-3 pt-3 border-t border-slate-800/60 space-y-2 animate-fade-in">
          ${citations.map((c, i) => `
            <div class="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
              <div class="flex items-center justify-between mb-1">
                <span class="font-bold text-brand-300 font-mono text-[11px]">[${escapeHtml(c.locator)}] Chunk #${i + 1}</span>
                <span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
                  Similarity: ${(c.score * 100).toFixed(1)}% (${c.score})
                </span>
              </div>
              <p class="text-slate-300 text-[11px] leading-relaxed font-mono whitespace-pre-wrap">${escapeHtml(c.snippet)}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white flex-shrink-0 shadow-md">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </div>
    <div class="flex-1 max-w-2xl space-y-1">
      <div class="p-4 rounded-2xl rounded-tl-sm bg-slate-900/90 border border-slate-800 shadow-sm">
        ${guardrailBanner}
        <div class="prose-dark text-xs md:text-sm">
          ${parsedHtml}
        </div>
        ${sourcesHtml}
      </div>
      <div class="flex items-center justify-between px-1 text-[10px] text-slate-500 font-mono">
        <div class="flex items-center gap-2">
          ${topScore !== null ? `<span>Top Score: <strong>${topScore}</strong></span>` : ''}
          <span>• Sources: ${citations.length}</span>
        </div>
        <button onclick="copyAnswerText(this)" data-text="${escapeHtml(rawAnswer)}" class="hover:text-slate-300 flex items-center gap-1 transition-colors">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </button>
      </div>
    </div>
  `;
}

/**
 * Replace loading placeholder with error
 */
function replaceLoadingWithError(loadingId, errorMsg) {
  const el = document.getElementById(loadingId);
  if (!el) return;
  el.innerHTML = `
    <div class="w-8 h-8 rounded-xl bg-rose-600 flex items-center justify-center text-white flex-shrink-0 shadow-md">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
    <div class="flex-1 max-w-2xl">
      <div class="p-4 rounded-2xl rounded-tl-sm bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs md:text-sm">
        <strong>Error:</strong> ${escapeHtml(errorMsg)}
      </div>
    </div>
  `;
}

/**
 * Open Chunks Inspector Modal
 */
async function openChunksModal(docId) {
  if (!docId) {
    showToast('No document selected to inspect', 'error');
    return;
  }

  const modal = document.getElementById('chunksModal');
  const body = document.getElementById('modalChunksBody');
  const title = document.getElementById('modalDocTitle');
  const countBadge = document.getElementById('modalChunksCountBadge');
  const searchInput = document.getElementById('chunksSearchInput');

  searchInput.value = '';
  body.innerHTML = `
    <div class="text-center py-12 text-slate-400 text-xs">
      <div class="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
      Loading document chunks...
    </div>
  `;
  modal.classList.remove('hidden');

  const doc = documents.find(d => d.documentId === docId);
  title.innerText = doc ? doc.title : 'Document Chunks';

  try {
    const res = await fetch(`/documents/${docId}/chunks`);
    if (!res.ok) throw new Error('Failed to fetch chunks');
    const data = await res.json();
    currentModalChunks = data.chunks || [];
    countBadge.innerText = currentModalChunks.length;
    renderModalChunks(currentModalChunks);
  } catch (err) {
    body.innerHTML = `
      <div class="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
        Failed to load chunks: ${err.message}
      </div>
    `;
  }
}

function closeChunksModal() {
  document.getElementById('chunksModal').classList.add('hidden');
}

function filterModalChunks() {
  const query = document.getElementById('chunksSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderModalChunks(currentModalChunks);
    return;
  }
  const filtered = currentModalChunks.filter(c => 
    (c.content && c.content.toLowerCase().includes(query)) ||
    (c.locator && c.locator.toLowerCase().includes(query))
  );
  renderModalChunks(filtered);
}

function renderModalChunks(chunks) {
  const body = document.getElementById('modalChunksBody');
  if (chunks.length === 0) {
    body.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-xs">
        No chunks found matching search query.
      </div>
    `;
    return;
  }

  body.innerHTML = chunks.map((c, i) => `
    <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 font-mono text-[11px] font-bold">
            Chunk #${c.chunkIndex !== undefined ? c.chunkIndex + 1 : i + 1}
          </span>
          <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
            Citation: [${escapeHtml(c.locator)}]
          </span>
        </div>
        <span class="text-[10px] text-slate-500 font-mono">
          ${c.content.length} characters
        </span>
      </div>
      <p class="text-slate-300 leading-relaxed font-mono text-[11px] bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 whitespace-pre-wrap">${escapeHtml(c.content)}</p>
    </div>
  `).join('');
}

/**
 * Textarea Auto-Resize & Keyboard Handler
 */
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  document.getElementById('charCount').innerText = `${textarea.value.length} characters`;
}

function handleTextareaKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('askForm').dispatchEvent(new Event('submit'));
  }
}

/**
 * Toggle debug chunks list
 */
function toggleDebugChunks(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const isHidden = el.classList.contains('hidden');
  if (isHidden) {
    el.classList.remove('hidden');
    if (btn) {
      const svg = btn.querySelector('svg');
      if (svg) svg.classList.add('rotate-180');
    }
  } else {
    el.classList.add('hidden');
    if (btn) {
      const svg = btn.querySelector('svg');
      if (svg) svg.classList.remove('rotate-180');
    }
  }
}

/**
 * Open Source Preview Modal
 */
function openSourcePreviewModal(locator, snippet, score) {
  const modal = document.getElementById('sourcePreviewModal');
  if (!modal) {
    showToast(`Source [${locator}]: ${snippet.slice(0, 100)}...`, 'info');
    return;
  }
  document.getElementById('sourcePreviewLocator').innerText = `[${locator}]`;
  document.getElementById('sourcePreviewScore').innerText = score ? `Cosine Similarity: ${(score * 100).toFixed(1)}% (${score})` : '';
  document.getElementById('sourcePreviewSnippet').innerText = snippet;
  modal.classList.remove('hidden');
}

function closeSourcePreviewModal() {
  const modal = document.getElementById('sourcePreviewModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Highlight Citation Chip Click
 */
function highlightCitation(locator) {
  showToast(`Source citation: [${locator}]`, 'info');
}

/**
 * Copy Answer Text to Clipboard
 */
function copyAnswerText(button) {
  const text = button.getAttribute('data-text');
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied answer to clipboard!', 'info');
  });
}

function clearChatHistory() {
  document.getElementById('messagesContainer').innerHTML = '';
  if (activeDocument) {
    appendAssistantWelcome(activeDocument);
  }
  showToast('Chat history cleared', 'info');
}

function scrollToBottom() {
  const container = document.getElementById('chatScrollContainer');
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

function setLoading(button, textSpan, spinner, isLoading, loadingText) {
  button.disabled = isLoading;
  if (isLoading) {
    textSpan.innerText = loadingText;
    spinner.classList.remove('hidden');
  } else {
    textSpan.innerText = loadingText;
    spinner.classList.add('hidden');
  }
}

/**
 * Toast Notification System
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');

  let typeClasses = 'bg-slate-900 border-slate-700 text-slate-200';
  let iconSvg = `
    <svg class="w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  `;

  if (type === 'success') {
    typeClasses = 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200';
    iconSvg = `
      <svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
    `;
  } else if (type === 'error') {
    typeClasses = 'bg-rose-950/90 border-rose-500/40 text-rose-200';
    iconSvg = `
      <svg class="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    `;
  }

  toast.className = `flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-xl text-xs font-medium backdrop-blur-md pointer-events-auto transition-all transform duration-200 translate-y-2 opacity-0 ${typeClasses}`;
  toast.innerHTML = `${iconSvg} <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  // Auto dismiss after 3.5s
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function escapeHtml(string) {
  if (!string) return '';
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

