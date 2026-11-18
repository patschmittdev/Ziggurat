import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeText } from '../authorization/canonical.js';
import { sha256Text } from '../bronze/canonical.js';
import { RefinementDraftSchema } from '../contracts/refinement-draft.js';
import type { DraftEvidence } from '../contracts/refinement-draft.js';
import { RefinementProposalPayloadSchema } from '../contracts/proposal.js';
import type { RefinementProposalPayload } from '../contracts/proposal.js';
import type { EvidenceCitation } from '../contracts/common.js';
import { isKnowledgePath } from '../contracts/path.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import type { BronzeReference } from './context.js';
import { RefinementError } from './errors.js';
import { compareCodeUnits } from '../order.js';

export interface TargetSnapshot {
  target_path: string;
  content?: string;
  sha256?: string;
}

export async function readTargetSnapshot(
  root: string,
  targetPath: string,
): Promise<TargetSnapshot> {
  if (!isKnowledgePath(targetPath)) {
    throw new RefinementError('target-path', 'Target must be a lowercase top-level knowledge Markdown path.');
  }
  const path = join(root, targetPath);
  try {
    await assertRealPathWithinRoot(root, path, 'Proposal target');
    const content = await readFile(path, 'utf8');
    return { target_path: targetPath, content, sha256: sha256Text(normalizeText(content)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { target_path: targetPath };
  }
}

export function materializeDraft(
  raw: unknown,
  reference: BronzeReference,
  target?: TargetSnapshot,
): RefinementProposalPayload {
  const parsed = RefinementDraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RefinementError('draft-schema', 'Model response failed the strict refinement draft schema.');
  }
  const draft = parsed.data;
  if (target !== undefined && draft.target_path !== target.target_path) {
    throw new RefinementError('target-context', 'Model target does not match the host-selected target.');
  }
  if (draft.operation !== 'create' && target?.sha256 === undefined) {
    throw new RefinementError('target-context', 'Amend and contradict require host-read existing target context.');
  }
  if (draft.operation === 'create' && target?.content !== undefined) {
    throw new RefinementError('target-context', 'Create cannot replace an existing target.');
  }
  const sources = new Map(reference.sources.map(source => [source.source_id, source]));
  if (sources.size !== reference.sources.length) {
    throw new RefinementError('unknown-source', 'Reference contains duplicate host source identifiers.');
  }
  function citation(range: DraftEvidence): EvidenceCitation {
    const source = sources.get(range.source_id);
    if (source === undefined) {
      throw new RefinementError('unknown-source', 'Citation does not identify a source included in this request.');
    }
    if (range.line_end < range.line_start || range.line_end > source.lines.length) {
      throw new RefinementError('line-range', 'Citation range is outside the supplied source lines.');
    }
    const quote = source.lines.slice(range.line_start - 1, range.line_end).join('\n');
    return {
      source_path: source.source_path,
      body_sha256: source.body_sha256,
      line_start: range.line_start,
      line_end: range.line_end,
      quote,
      quote_sha256: sha256Text(quote),
    };
  }
  const evidence = draft.evidence.map(citation);
  const contradictions = draft.contradictions.map(item => ({
    summary: item.summary,
    evidence: item.evidence.map(citation),
  }));
  const sourcePaths = [...new Set([
    ...evidence,
    ...contradictions.flatMap(item => item.evidence),
  ].map(item => item.source_path))].sort(compareCodeUnits);
  const payload = RefinementProposalPayloadSchema.safeParse({
    ...draft,
    schema_version: 2,
    candidate: {
      ...draft.candidate,
      schema_version: 1,
      sources: sourcePaths,
      confidence: draft.confidence,
    },
    evidence,
    contradictions,
    ...(draft.operation === 'create' ? {} : { base_content_sha256: target?.sha256 }),
  });
  if (!payload.success) {
    throw new RefinementError('canonical-schema', 'Draft cannot form a strict Silver v2 proposal; check paths and operation constraints.');
  }
  return payload.data;
}
