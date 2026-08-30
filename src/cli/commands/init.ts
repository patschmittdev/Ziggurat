import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CliIO } from '../main.js';

const STARTER_DIRS = [
  'bronze',
  'knowledge',
  'authorizations',
  '.ziggurat/proposals',
  'inbox',
  'config',
];

const STARTER_CONFIGS: Record<string, string> = {
  'config/ziggurat.yaml': `schema_version: 1\nlifecycle:\n  review_queue_limit: 20\n`,
  'config/domain.yaml': `domain:\n  page_types:\n    - concept\n    - entity\n    - comparison\n    - query\n  tags:\n    - general\n`,
  'config/privacy.yaml': `privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n`,
  'config/adapters.yaml': `adapters: {}\n`,
  'config/trust.yaml': `trust:\n  reviewers: []\n`,
};

const SCHEMA_VERSION_RE = /^schema_version:\s*(\d+)/m;

/** Initializes a Ziggurat vault idempotently. Never overwrites existing config. */
export async function runInit(root: string, io: CliIO): Promise<number> {
  // If a ziggurat.yaml exists and has a different schema version, refuse.
  const configPath = join(root, 'config', 'ziggurat.yaml');
  try {
    const { readFile } = await import('node:fs/promises');
    const existing = await readFile(configPath, 'utf8');
    const match = SCHEMA_VERSION_RE.exec(existing);
    if (match !== null && match[1] !== '1') {
      io.stderr(`error: existing vault has schema_version ${match[1]}, expected 1\n`);
      return 1;
    }
    // Already initialized; idempotently ensure directories exist.
  } catch {
    // No existing config - proceed with fresh init.
  }

  for (const dir of STARTER_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }

  for (const [relPath, content] of Object.entries(STARTER_CONFIGS)) {
    const fullPath = join(root, relPath);
    try {
      await writeFile(fullPath, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  io.stdout(`Initialized Ziggurat vault at ${root}\n`);
  return 0;
}
