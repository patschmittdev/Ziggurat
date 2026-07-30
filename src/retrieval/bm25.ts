/** Tokenizes text to lowercase Unicode word tokens. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const matches = text.matchAll(/\p{L}+/gu);
  for (const m of matches) {
    tokens.push(m[0].toLowerCase());
  }
  return tokens;
}

/** Computes BM25 term frequencies for a document. */
export function termFreqs(tokens: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const t of tokens) {
    freq[t] = (freq[t] ?? 0) + 1;
  }
  return freq;
}

/** Builds a Bm25Snapshot from a set of documents. */
export function buildBm25(
  docs: Array<{ id: string; text: string }>,
  k1 = 1.5,
  b = 0.75,
): import('../contracts/gold-index.js').Bm25Snapshot {
  const doc_lengths: Record<string, number> = {};
  const term_doc_freqs: Record<string, Record<string, number>> = {};

  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    doc_lengths[doc.id] = tokens.length;
    const tf = termFreqs(tokens);
    for (const [term, freq] of Object.entries(tf)) {
      if (term_doc_freqs[term] === undefined) term_doc_freqs[term] = {};
      term_doc_freqs[term][doc.id] = freq;
    }
  }

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
  const scores: Record<string, number> = {};

  for (const term of queryTokens) {
    const docFreqMap = term_doc_freqs[term];
    if (docFreqMap === undefined) continue;
    const df = Object.keys(docFreqMap).length;
    const idf = Math.log((doc_count - df + 0.5) / (df + 0.5) + 1);
    for (const [docId, tf] of Object.entries(docFreqMap)) {
      const dl = doc_lengths[docId] ?? 0;
      const norm = 1 - b + b * (dl / (avg_doc_length || 1));
      const score = idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
      scores[docId] = (scores[docId] ?? 0) + score;
    }
  }

  return Object.entries(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b_) => b_.score !== a.score ? b_.score - a.score : a.id < b_.id ? -1 : 1);
}
