// Splits extracted document text into overlapping pieces small enough to
// search precisely, while keeping paragraphs and sentences intact where
// possible. No imports, so it can be unit tested directly.

export type ChunkOptions = {
  /** Aim for chunks around this many characters. */
  targetSize?: number;
  /** Never produce a chunk longer than this. */
  maxSize?: number;
  /** Characters repeated from the end of one chunk at the start of the next. */
  overlap?: number;
};

export function chunkText(text: string, { targetSize = 1000, maxSize = 1600, overlap = 200 }: ChunkOptions = {}) {
  const pieces = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLong(paragraph, maxSize));

  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= targetSize || !current) {
      current = candidate.length <= maxSize ? candidate : piece;
      continue;
    }
    chunks.push(current);
    const tail = overlapTail(current, overlap);
    current = tail && tail.length + piece.length + 2 <= maxSize ? `${tail}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Splits a paragraph longer than maxSize at sentence, then word, boundaries. */
function splitLong(paragraph: string, maxSize: number): string[] {
  if (paragraph.length <= maxSize) return [paragraph];

  const sentences = paragraph.split(/(?<=[.!?।])\s+|\n/).filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const sentence of sentences.flatMap((s) => (s.length > maxSize ? splitWords(s, maxSize) : [s]))) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxSize) {
      result.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(current);
  return result;
}

function splitWords(text: string, maxSize: number): string[] {
  const result: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    // A single "word" longer than maxSize (rare, e.g. a long URL) is cut.
    for (let i = 0; i < word.length; i += maxSize) {
      const part = word.slice(i, i + maxSize);
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length > maxSize) {
        result.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
  }
  if (current) result.push(current);
  return result;
}

/** The last `size` characters of a chunk, starting at a word boundary. */
function overlapTail(chunk: string, size: number) {
  if (size <= 0 || chunk.length <= size) return "";
  const tail = chunk.slice(-size);
  const firstSpace = tail.search(/\s/);
  return firstSpace === -1 ? tail : tail.slice(firstSpace + 1).trim();
}
