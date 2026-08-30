import type { CliIO } from '../main.js';
import { startMcpServer } from '../../mcp/server.js';

export async function runMcp(
  root: string,
  _json: boolean,
  _io: CliIO,
): Promise<number> {
  await startMcpServer(root);
  return 0;
}
