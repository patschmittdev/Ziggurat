import type { CliIO } from '../main.js';

export async function runCheck(_root: string, _json: boolean, io: CliIO): Promise<number> {
  io.stdout('Clean-room check: not yet implemented\n');
  return 0;
}
