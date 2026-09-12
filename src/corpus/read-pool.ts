export const CORPUS_READ_CONCURRENCY = 32;

/** Bounds independent reads without changing input order or outliving a failed scan. */
export async function mapCorpusReads<T, R>(
  entries: readonly T[],
  read: (entry: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(entries.length);
  let next = 0;
  let failed = false;
  let failedIndex = Number.POSITIVE_INFINITY;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = next++;
      if (index >= entries.length) return;
      try {
        results[index] = await read(entries[index]!, index);
      } catch (error) {
        if (index < failedIndex) {
          failed = true;
          failedIndex = index;
          failure = error;
        }
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(CORPUS_READ_CONCURRENCY, entries.length) },
    worker,
  ));
  if (failed) throw failure;
  return results;
}

/** A request-local limiter for lazily discovered, deduplicated source reads. */
export function createCorpusReadLimiter(): <R>(read: () => Promise<R>) => Promise<R> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <R>(read: () => Promise<R>): Promise<R> => {
    if (active >= CORPUS_READ_CONCURRENCY) {
      await new Promise<void>(resolve => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      return await read();
    } finally {
      const next = waiting.shift();
      if (next === undefined) active--;
      else next();
    }
  };
}
