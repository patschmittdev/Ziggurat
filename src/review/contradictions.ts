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
 * Raised when contradiction state cannot be established. Corrupting an artifact must
 * never be a way to restore a blocked page's eligibility, so an unreadable proposals
 * directory or an unparseable artifact fails the build instead of reading as "no
 * contradictions found".
 */
export class ContradictionScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContradictionScanError';
  }
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Returns all unresolved contradiction artifacts targeting the given knowledge path.
 * A contradiction is resolved only when both resolved_at and resolution are present.
 *
 * An absent proposals directory legitimately means "nothing staged". Any other failure
 * to read it, and any artifact that cannot be parsed or that claims to be a
 * contradiction but does not validate, raises ContradictionScanError.
 */
export async function collectUnresolvedContradictions(
  root: string,
  targetPath: string,
): Promise<UnresolvedContradiction[]> {
  const proposalsDir = join(root, '.ziggurat', 'proposals');

  let entries: string[];
  try {
    entries = await readdir(proposalsDir);
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw new ContradictionScanError(
      `Cannot read proposals directory ${proposalsDir}; contradiction state is unknown.`,
    );
  }

  const unresolved: UnresolvedContradiction[] = [];

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue;
    const artifactPath = join(proposalsDir, entry);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(artifactPath, 'utf8'));
    } catch {
      throw new ContradictionScanError(
        `Proposal artifact ${artifactPath} is unreadable or is not valid JSON; contradiction state is unknown.`,
      );
    }

    // The proposals directory also holds create and amend artifacts. Those are not
    // contradictions and are skipped, but anything that does not even declare a
    // recognizable operation is treated as corrupt rather than ignored.
    const operation = (parsed as { operation?: unknown } | null)?.operation;
    if (typeof operation !== 'string') {
      throw new ContradictionScanError(
        `Proposal artifact ${artifactPath} declares no operation; contradiction state is unknown.`,
      );
    }
    if (operation !== 'contradict') continue;

    const result = ContradictionArtifactSchema.safeParse(parsed);
    if (!result.success) {
      throw new ContradictionScanError(
        `Contradiction artifact ${artifactPath} failed validation; contradiction state is unknown.`,
      );
    }

    const artifact = result.data;
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
