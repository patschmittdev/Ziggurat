import type { CliIO } from '../main.js';
import { startMcpServer } from '../../mcp/server.js';
import type { AccessProfile } from '../../contracts/index.js';

const VALID_PROFILES = new Set<string>(['communion', 'review', 'evidence']);

export async function runMcp(root: string, profile: string | undefined, _json: boolean, io: CliIO): Promise<number> {
  if (!profile) {
    io.stderr('error: --profile is required for the mcp command (communion|review|evidence)\n');
    return 1;
  }
  if (!VALID_PROFILES.has(profile)) {
    io.stderr(`error: unknown profile "${profile}". Use communion, review, or evidence\n`);
    return 1;
  }
  await startMcpServer(root, profile as AccessProfile);
  return 0;
}
