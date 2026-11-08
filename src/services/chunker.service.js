/**
 * Splits text into chunks of ~chunkSize characters with overlap.
 * Tries to break cleanly at sentence or word boundaries when possible.
 *
 * @param {string} text - Input text to split
 * @param {string} locator - Source citation locator (e.g., "Page 1", "Section: Intro")
 * @param {number} chunkSize - Target size of each chunk in characters (default 800)
 * @param {number} overlap - Overlap between adjacent chunks in characters (default 150)
 * @returns {Array<{ content: string, locator: string }>}
 */
function splitIntoChunks(text, locator, chunkSize = 800, overlap = 150) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  if (cleaned.length <= chunkSize) {
    return [{ content: cleaned, locator }];
  }

  const chunks = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = start + chunkSize;

    if (end < cleaned.length) {
      // Try to find a natural sentence break (. ! ?) or space near the end
      const lookbackWindow = cleaned.slice(start + Math.floor(chunkSize * 0.7), end);
      const lastSentenceBreak = Math.max(
        lookbackWindow.lastIndexOf('. '),
        lookbackWindow.lastIndexOf('! '),
        lookbackWindow.lastIndexOf('? ')
      );

      if (lastSentenceBreak !== -1) {
        end = start + Math.floor(chunkSize * 0.7) + lastSentenceBreak + 1;
      } else {
        const lastSpace = cleaned.lastIndexOf(' ', end);
        if (lastSpace > start + overlap) {
          end = lastSpace;
        }
      }
    }

    const piece = cleaned.slice(start, end).trim();
    if (piece) {
      chunks.push({ content: piece, locator });
    }

    if (end >= cleaned.length) break;

    // Advance start with overlap, but snap to the next word boundary to avoid slicing words in half
    let nextStart = Math.max(start + 1, end - overlap);
    const nextSpace = cleaned.indexOf(' ', nextStart);
    if (nextSpace !== -1 && nextSpace < end) {
      start = nextSpace + 1;
    } else {
      start = nextStart;
    }
  }

  return chunks;
}

/**
 * Takes an array of segments (each with { text, locator }) and produces
 * indexed chunks of ~800 chars with overlap.
 *
 * @param {Array<{ text: string, locator: string }>} segments
 * @param {number} chunkSize
 * @param {number} overlap
 * @returns {Array<{ content: string, locator: string, chunkIndex: number }>}
 */
function chunkSegments(segments, chunkSize = 800, overlap = 150) {
  const allChunks = [];
  let globalIndex = 0;

  for (const segment of segments) {
    const segChunks = splitIntoChunks(segment.text, segment.locator, chunkSize, overlap);
    for (const c of segChunks) {
      allChunks.push({
        content: c.content,
        locator: c.locator,
        chunkIndex: globalIndex++,
      });
    }
  }

  return allChunks;
}

module.exports = {
  splitIntoChunks,
  chunkSegments,
};
