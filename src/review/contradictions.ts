import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const ContradictionArtifactSchema = z.object({
  schema_version: z.literal(1),
  operation: z.literal('contradict'),
  target_path: z.string().min(1),
  resolved_at: z.string().optional(),
  resolution: z.string().optional(),
});

export type ContradictionArtifact = z.infer<typeof ContradictionArtifactSchema>;

export interface UnresolvedContradiction {
  artifact_path: string;
  target_path: string;
}

/**
 * Returns all unresolved contradiction artifacts targeting the given knowledge path.
 * A contradiction is resolved only when both resolved_at and resolution are present.
 */
export async function collectUnresolvedContradictions(
  root: string,
  targetPath: string,
): Promise<UnresolvedContradiction[]> {
  const proposalsDir = join(root, '.ziggurat', 'proposals');

  let entries: string[];
  try {
    entries = await readdir(proposalsDir);
  } catch {
    return [];
  }

  const unresolved: UnresolvedContradiction[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const artifactPath = join(proposalsDir, entry);
    let parsed: unknown;
    try {
      const text = await readFile(artifactPath, 'utf8');
      parsed = JSON.parse(text);
    } catch {
      continue;
    }

    const result = ContradictionArtifactSchema.safeParse(parsed);
    if (!result.success) continue;

    const artifact = result.data;
    if (artifact.operation !== 'contradict') continue;
    if (artifact.target_path !== targetPath) continue;

    const resolved =
      artifact.resolved_at !== undefined &&
      artifact.resolved_at.length > 0 &&
      artifact.resolution !== undefined &&
      artifact.resolution.length > 0;

    if (!resolved) {
      unresolved.push({ artifact_path: artifactPath, target_path: targetPath });
    }
  }

  return unresolved;
}
