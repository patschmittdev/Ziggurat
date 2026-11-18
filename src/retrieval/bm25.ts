/** NFC Unicode words, identifiers, numeric versions, and C++/C#; hyphens separate words. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const matches = text.normalize('NFC').toLowerCase().matchAll(
    /c(?:\+\+|#)(?![\p{L}\p{M}\p{N}_])|[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*(?:\.\p{N}+)*/gu,
  );
  for (const m of matches) {
    tokens.push(m[0]);
  }
  return tokens;
}

/** Computes BM25 term frequencies for a document. */
export function termFreqs(tokens: string[]): Record<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return Object.fromEntries(freq);
}

/** Builds a Bm25Snapshot from a set of documents. */
export function buildBm25(
  docs: Array<{ id: string; text: string }>,
  k1 = 1.5,
  b = 0.75,
): import('../contracts/gold-index.js').Bm25Snapshot {
  const lengths = new Map<string, number>();
  const postings = new Map<string, Map<string, number>>();

  for (const doc of docs) {
    if (lengths.has(doc.id)) throw new Error(`Duplicate BM25 document ID: ${doc.id}`);
    const tokens = tokenize(doc.text);
    lengths.set(doc.id, tokens.length);
    const tf = termFreqs(tokens);
    for (const [term, freq] of Object.entries(tf)) {
      let termPostings = postings.get(term);
      if (termPostings === undefined) {
        termPostings = new Map();
        postings.set(term, termPostings);
      }
      termPostings.set(doc.id, freq);
    }
  }

  // Plain own properties survive JSON and schema round trips with the same prototypes.
  const doc_lengths = Object.fromEntries(lengths);
  const term_doc_freqs = Object.fromEntries(
    Array.from(postings, ([term, frequencies]) => [term, Object.fromEntries(frequencies)]),
  );
  const doc_count = docs.length;
  const total = Object.values(doc_lengths).reduce((s, n) => s + n, 0);
  const avg_doc_length = doc_count === 0 ? 0 : total / doc_count;

  return { k1, b, avg_doc_length, doc_count, doc_lengths, term_doc_freqs };
}

/** Scores all documents against a query using BM25. Returns sorted [{id, score}]. */
export function bm25Search(
  query: string,
  bm25: import('../contracts/gold-index.js').Bm25Snapshot,
): Array<{ id: string; score: number }> {
  const { k1, b, avg_doc_length, doc_count, doc_lengths, term_doc_freqs } = bm25;
  const queryTokens = tokenize(query);
  const scores = new Map<string, number>();

  for (const term of queryTokens) {
    if (!Object.hasOwn(term_doc_freqs, term)) continue;
    const docFreqMap = term_doc_freqs[term];
    if (docFreqMap === undefined) continue;
    const df = Object.keys(docFreqMap).length;
    const idf = Math.log((doc_count - df + 0.5) / (df + 0.5) + 1);
    for (const [docId, tf] of Object.entries(docFreqMap)) {
      if (!Object.hasOwn(doc_lengths, docId)) continue;
      const dl = doc_lengths[docId] ?? 0;
      const norm = 1 - b + b * (dl / (avg_doc_length || 1));
      const score = idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
      scores.set(docId, (scores.get(docId) ?? 0) + score);
    }
  }

  return Array.from(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b_) => b_.score - a.score || (a.id < b_.id ? -1 : a.id > b_.id ? 1 : 0));
}
