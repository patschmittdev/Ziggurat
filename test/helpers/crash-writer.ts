import { writeIndexAtomic } from '../../src/retrieval/store.js';

const root = process.argv[2];
if (root === undefined || process.send === undefined) throw new Error('Crash worker requires a test root and IPC');
await writeIndexAtomic(root, 'gold-index.json', {
  get body() {
    process.send?.('temporary-file-open');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
    return 'unpublished';
  },
});
