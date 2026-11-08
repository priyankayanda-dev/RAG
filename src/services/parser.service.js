const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');

/**
 * Extracts text per page from a PDF Buffer so every chunk retains its exact Page number.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{ segments: Array<{ text: string, locator: string }>, pageCount: number }>}
 */
async function parsePdfBuffer(pdfBuffer) {
  const pages = [];
  let currentPage = 0;

  const options = {
    pagerender: async function (pageData) {
      currentPage += 1;
      const pageNum = pageData.pageIndex !== undefined ? pageData.pageIndex + 1 : currentPage;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });

      let lastY = null;
      let pageText = '';

      for (const item of textContent.items) {
        if (lastY === item.transform[5] || lastY === null) {
          pageText += item.str + ' ';
        } else {
          pageText += '\n' + item.str + ' ';
        }
        lastY = item.transform[5];
      }

      const cleaned = pageText.replace(/\s+/g, ' ').trim();
      if (cleaned) {
        pages.push({
          text: cleaned,
          locator: `Page ${pageNum}`,
        });
      }
      return cleaned;
    },
  };

  const data = await pdfParse(pdfBuffer, options);

  // Fallback if pagerender produced no pages but data.text exists
  if (pages.length === 0 && data.text && data.text.trim()) {
    pages.push({
      text: data.text.trim(),
      locator: 'Page 1',
    });
  }

  return {
    segments: pages,
    pageCount: data.numpages || pages.length,
  };
}

/**
 * Fetches and parses a website URL into structured sections with section/heading citations.
 *
 * @param {string} url
 * @returns {Promise<{ title: string, segments: Array<{ text: string, locator: string }> }>}
 */
async function parseWebsiteUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL provided: ${url}`);
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; RAGLiteBot/1.0; +https://github.com/rag-lite)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status} ${response.statusText})`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const pageTitle =
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    parsedUrl.hostname;

  // Remove noise elements
  $('script, style, noscript, iframe, nav, footer, header, svg, form, aside').remove();

  const segments = [];
  let currentHeading = 'Introduction';
  let currentBuffer = [];

  const flushSection = () => {
    const joined = currentBuffer.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length > 30) {
      segments.push({
        text: joined,
        locator: `Section: ${currentHeading} (${parsedUrl.hostname})`,
      });
    }
    currentBuffer = [];
  };

  // Traverse headings and content blocks in document order
  $('body')
    .find('h1, h2, h3, h4, p, li, article, section, pre, blockquote, td')
    .each((_, el) => {
      const tag = (el.tagName || '').toLowerCase();
      if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
        const headingText = $(el).text().replace(/\s+/g, ' ').trim();
        if (headingText) {
          flushSection();
          currentHeading = headingText.slice(0, 80);
        }
      } else if (['p', 'li', 'pre', 'blockquote'].includes(tag)) {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.length > 20) {
          currentBuffer.push(text);
        }
      }
    });

  flushSection();

  // Fallback if the page didn't use standard <p>/<li> tags
  if (segments.length === 0) {
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    if (!bodyText) {
      throw new Error('Could not extract readable text content from the URL');
    }
    segments.push({
      text: bodyText,
      locator: `Webpage (${parsedUrl.hostname})`,
    });
  }

  return {
    title: pageTitle,
    segments,
  };
}

/**
 * Parses raw text input into segments. Supports optional "[Page X]" markers or paragraphs.
 *
 * @param {string} rawText
 * @returns {Array<{ text: string, locator: string }>}
 */
function parseRawText(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error('Provided text is empty');
  }

  // Check if the user supplied explicit [Page X] markers in raw text
  const pageMarkerRegex = /\[Page\s+(\d+)\]/gi;
  if (pageMarkerRegex.test(rawText)) {
    const parts = rawText.split(/\[Page\s+(\d+)\]/i);
    const segments = [];
    // parts[0] is text before first marker, then pairs of (pageNum, pageContent)
    if (parts[0] && parts[0].trim()) {
      segments.push({ text: parts[0].trim(), locator: 'Page 1' });
    }
    for (let i = 1; i < parts.length; i += 2) {
      const pageNum = parts[i];
      const pageContent = (parts[i + 1] || '').trim();
      if (pageContent) {
        segments.push({ text: pageContent, locator: `Page ${pageNum}` });
      }
    }
    if (segments.length > 0) return segments;
  }

  // Otherwise group paragraphs into logical sections (~1600 chars per section)
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [{ text: rawText.trim(), locator: 'Section 1' }];
  }

  const segments = [];
  let currentSection = [];
  let currentLen = 0;
  let sectionNum = 1;

  for (const para of paragraphs) {
    if (currentLen + para.length > 1600 && currentSection.length > 0) {
      segments.push({
        text: currentSection.join(' '),
        locator: `Section ${sectionNum++}`,
      });
      currentSection = [];
      currentLen = 0;
    }
    currentSection.push(para);
    currentLen += para.length;
  }

  if (currentSection.length > 0) {
    segments.push({
      text: currentSection.join(' '),
      locator: `Section ${sectionNum}`,
    });
  }

  return segments;
}

module.exports = {
  parsePdfBuffer,
  parseWebsiteUrl,
  parseRawText,
};
