import type { CliIO } from '../main.js';
import { ingestCapture } from '../../bronze/ingest.js';
import { inertSingleLineText } from '../../presentation/inert.js';

export async function runIngest(root: string, file: string | undefined, json: boolean, io: CliIO): Promise<number> {
  if (!file) {
    io.stderr('error: --file is required for the ingest command\n');
    return 1;
  }
  const result = await ingestCapture(root, file, { now: new Date(), sourceKind: 'article' });
  if (json) {
    io.stdout(JSON.stringify(result, null, 2) + '\n');
  } else {
    io.stdout(`${result.status}: ${inertSingleLineText(result.source_path)}\n`);
  }
  return 0;
}
