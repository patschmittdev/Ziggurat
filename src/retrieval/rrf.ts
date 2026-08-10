import type { RrfEntry } from '../contracts/index.js';

/**
 * Fuses multiple ranked result lists using Reciprocal Rank Fusion.
 * Score = sum(1 / (k + rank)), ranks start at 1.
 * Ties broken by lexical id order (stable).
 * @param lists  Arrays of document IDs in rank order (highest first).
 * @param k      Fixed constant (typically 60).
 */
export function reciprocalRankFusion(lists: string[][], k: number): RrfEntry[] {
  const scores = new Map<string, number>();

  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (id === undefined) continue;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : 1);
}
