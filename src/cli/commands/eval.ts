import type { CliIO } from '../main.js';

export async function runEval(_root: string, _json: boolean, io: CliIO): Promise<number> {
  io.stdout('Conformance eval: not yet implemented\n');
  return 0;
}
