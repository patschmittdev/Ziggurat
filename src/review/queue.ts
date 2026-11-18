import { sha256Text } from '../bronze/canonical.js';
import type { CuratedPage, EvidenceCitation, RefinementCandidate } from '../contracts/index.js';
import { CuratedPageSchema } from '../contracts/index.js';
import type { ZigguratConfig } from '../contracts/config.js';
import { parseCorpusDocument } from '../corpus/documents.js';
import { readTargetSnapshot } from '../refine/materialize.js';
import type { StagedProposalRecord } from '../refine/store.js';
import { inertText } from '../presentation/inert.js';
import { compareCodeUnits } from '../order.js';

export type ReviewOrder = 'priority' | 'oldest';

export interface ReviewOptions {
  order?: ReviewOrder | undefined;
  cursor?: string | undefined;
}

const MODEL_FIELDS = [
  'schema_version', 'title', 'type', 'sources', 'confidence', 'retrieval_eligible',
  'pii', 'sensitivity', 'visibility', 'egress',
] as const;
const HUMAN_FIELDS = [
  'status', 'reviewed_by', 'reviewed_at', 'last_verified', 'review_after', 'resolved_proposals',
] as const;

type ModelMetadata = Pick<RefinementCandidate, typeof MODEL_FIELDS[number]>;

export interface MetadataChange {
  field: typeof MODEL_FIELDS[number];
  current: ModelMetadata[typeof MODEL_FIELDS[number]] | null;
  proposed: ModelMetadata[typeof MODEL_FIELDS[number]];
  change: 'added' | 'changed' | 'unchanged';
}

export interface QueueEntry {
  artifact_path: string;
  artifact_sha256: string;
  proposal_id: string;
  staged_at: string;
  operation: 'create' | 'amend' | 'contradict';
  target_path: string;
  candidate: RefinementCandidate;
  evidence: EvidenceCitation[];
  contradictions: Array<{ summary: string; evidence: EvidenceCitation[] }>;
  confidence: 'high' | 'medium' | 'low';
  affected_paths: string[];
  related_paths: string[];
  unresolved_questions: string[];
  base_content_sha256?: string;
  base_state: 'new-target' | 'matches' | 'missing' | 'mismatch' | 'create-conflict';
  current_content_sha256: string | null;
  current_target: {
    parse_state: 'valid' | 'invalid' | 'absent';
    parse_error?: string;
    raw_content?: string;
    human_metadata?: Partial<CuratedPage>;
  };
  comparison: {
    label: string;
    metadata: MetadataChange[];
    body_diff: string[];
  } | null;
}

export interface ReviewQueue {
  generated_at: string;
  /** Compatibility alias for displayed_count, not the backlog size. */
  count: number;
  total_count: number;
  displayed_count: number;
  remaining_count: number;
  render_limit: number;
  order: ReviewOrder;
  page_number: number;
  page_count: number;
  page_start: number;
  page_end: number;
  oldest_staged_at: string | null;
  oldest_age_seconds: number | null;
  next_cursor: string | null;
  entries: QueueEntry[];
}

export class ReviewNavigationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewNavigationError';
  }
}

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
const CURSOR_LIMIT = 512;

interface Cursor {
  v: 1;
  state: string;
  offset: number;
  order: ReviewOrder;
  limit: number;
}

function decodeCursor(value: string): Cursor {
  const invalid = () => new ReviewNavigationError(
    'Invalid review cursor. Restart review without --cursor.',
  );
  if (value.length === 0 || value.length > CURSOR_LIMIT || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw invalid();
  }
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw invalid();
    const cursor = JSON.parse(bytes.toString('utf8')) as Cursor;
    if (cursor === null || typeof cursor !== 'object'
      || Object.keys(cursor).sort().join(',') !== 'limit,offset,order,state,v'
      || cursor.v !== 1
      || typeof cursor.state !== 'string' || !/^[0-9a-f]{64}$/u.test(cursor.state)
      || !Number.isSafeInteger(cursor.offset) || cursor.offset <= 0
      || !Number.isSafeInteger(cursor.limit) || cursor.limit <= 0
      || (cursor.order !== 'priority' && cursor.order !== 'oldest')) {
      throw invalid();
    }
    return cursor;
  } catch {
    throw invalid();
  }
}

function metadata(candidate: ModelMetadata): ModelMetadata {
  return Object.fromEntries(MODEL_FIELDS.map(field => [field, candidate[field]])) as ModelMetadata;
}

/** Linear-time replacement diff; never reconstructs content from a stored digest. */
function bodyDiff(current: string | undefined, proposed: string): string[] {
  const before = current === undefined ? [] : current.split('\n');
  const after = proposed.split('\n');
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) {
    suffix++;
  }
  return [
    ...before.slice(0, prefix).map(line => `  ${line}`),
    ...before.slice(prefix, before.length - suffix).map(line => `- ${line}`),
    ...after.slice(prefix, after.length - suffix).map(line => `+ ${line}`),
    ...before.slice(before.length - suffix).map(line => `  ${line}`),
  ];
}

async function queueEntry(root: string, record: StagedProposalRecord): Promise<QueueEntry> {
  const proposal = record.proposal;
  const snapshot = await readTargetSnapshot(root, proposal.target_path);
  const base_state = proposal.operation === 'create'
    ? snapshot.content === undefined ? 'new-target' : 'create-conflict'
    : snapshot.content === undefined ? 'missing'
      : snapshot.sha256 === proposal.base_content_sha256 ? 'matches' : 'mismatch';
  const current = snapshot.content === undefined ? undefined
    : parseCorpusDocument(snapshot.content, CuratedPageSchema, [...MODEL_FIELDS, ...HUMAN_FIELDS]);
  const page = current?.valid === true ? current.data : undefined;
  const current_target: QueueEntry['current_target'] = current === undefined
    ? { parse_state: 'absent' }
    : page === undefined
      ? {
        parse_state: 'invalid',
        parse_error: current.valid ? 'Current target could not be parsed.' : current.failure.detail,
        raw_content: snapshot.content!,
      }
      : {
        parse_state: 'valid',
        human_metadata: Object.fromEntries(HUMAN_FIELDS
          .filter(field => page[field] !== undefined)
          .map(field => [field, page[field]])),
      };
  return {
    artifact_path: record.artifact_path,
    artifact_sha256: record.artifact_sha256,
    proposal_id: proposal.proposal_id,
    staged_at: proposal.staged_at,
    operation: proposal.operation,
    target_path: proposal.target_path,
    candidate: proposal.candidate,
    evidence: proposal.evidence,
    contradictions: proposal.contradictions,
    confidence: proposal.confidence,
    affected_paths: proposal.affected_paths,
    related_paths: proposal.related_paths,
    unresolved_questions: proposal.unresolved_questions,
    ...(proposal.base_content_sha256 === undefined
      ? {} : { base_content_sha256: proposal.base_content_sha256 }),
    base_state,
    current_content_sha256: snapshot.sha256 ?? null,
    current_target,
    comparison: current_target.parse_state === 'invalid' ? null : {
      label: base_state === 'matches'
        ? 'Matching-base current target versus proposal'
        : base_state === 'mismatch' || base_state === 'create-conflict'
          ? 'Current target versus proposal (not a historical-base diff)'
          : 'Absent current target versus proposal (additions only)',
      metadata: MODEL_FIELDS.map(field => ({
        field,
        current: page?.[field] ?? null,
        proposed: proposal.candidate[field],
        change: page === undefined ? 'added'
          : JSON.stringify(page[field]) === JSON.stringify(proposal.candidate[field])
            ? 'unchanged' : 'changed',
      })),
      body_diff: bodyDiff(
        current?.valid === true ? current.body : undefined,
        proposal.candidate.body,
      ),
    },
  };
}

export async function buildReviewQueue(
  root: string,
  proposals: StagedProposalRecord[],
  config: ZigguratConfig,
  options: ReviewOptions = {},
): Promise<ReviewQueue> {
  const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  const order = options.order ?? cursor?.order ?? 'priority';
  if (order !== 'priority' && order !== 'oldest') {
    throw new ReviewNavigationError('Review order must be priority or oldest.');
  }
  const limit = config.lifecycle.review_queue_limit;
  const generated = new Date();
  const entries: QueueEntry[] = [];
  // Read every target before slicing. A hidden change must invalidate navigation too.
  for (const record of proposals) {
    if (!Number.isFinite(Date.parse(record.proposal.staged_at))) {
      throw new ReviewNavigationError('A proposal has an invalid staged_at timestamp; review state is unknown.');
    }
    entries.push(await queueEntry(root, record));
  }
  entries.sort((left, right) => {
    if (order === 'priority') {
      const contradiction = Number(left.operation !== 'contradict') - Number(right.operation !== 'contradict');
      if (contradiction !== 0) return contradiction;
      const confidence = CONFIDENCE_ORDER[left.confidence] - CONFIDENCE_ORDER[right.confidence];
      if (confidence !== 0) return confidence;
    }
    return Date.parse(left.staged_at) - Date.parse(right.staged_at)
      || compareCodeUnits(left.proposal_id, right.proposal_id)
      || compareCodeUnits(left.artifact_path, right.artifact_path);
  });
  const state = sha256Text(JSON.stringify({
    order,
    limit,
    entries: entries.map(entry => [
      entry.artifact_path, entry.artifact_sha256, entry.proposal_id,
      entry.target_path, entry.current_content_sha256, entry.base_state,
    ]),
  }));
  const offset = cursor?.offset ?? 0;
  if (cursor !== undefined && (
    cursor.state !== state || cursor.order !== order || cursor.limit !== limit
    || offset >= entries.length || offset % limit !== 0
  )) {
    throw new ReviewNavigationError(
      'Review queue changed (proposals, targets, order, or render limit). Restart without --cursor; no page was returned.',
    );
  }
  const displayed = entries.slice(offset, offset + limit);
  const end = offset + displayed.length;
  const oldest = entries.reduce<QueueEntry | undefined>((result, entry) =>
    result === undefined || Date.parse(entry.staged_at) < Date.parse(result.staged_at) ? entry : result, undefined);
  return {
    generated_at: generated.toISOString(),
    count: displayed.length,
    total_count: entries.length,
    displayed_count: displayed.length,
    remaining_count: entries.length - end,
    render_limit: limit,
    order,
    page_number: entries.length === 0 ? 0 : Math.floor(offset / limit) + 1,
    page_count: Math.ceil(entries.length / limit),
    page_start: displayed.length === 0 ? 0 : offset + 1,
    page_end: end,
    oldest_staged_at: oldest?.staged_at ?? null,
    oldest_age_seconds: oldest === undefined ? null
      : Math.max(0, Math.floor((generated.getTime() - Date.parse(oldest.staged_at)) / 1000)),
    next_cursor: end === entries.length ? null : Buffer.from(JSON.stringify({
      v: 1, state, offset: end, order, limit,
    } satisfies Cursor)).toString('base64url'),
    entries: displayed,
  };
}

function literal(value: string): string[] {
  // Blank boundaries are essential: four spaces alone do not interrupt Markdown paragraphs.
  return ['', ...inertText(value).split('\n').map(line => `    ${line}`), ''];
}

function renderEvidence(citations: EvidenceCitation[]): string[] {
  const lines: string[] = [];
  citations.forEach((citation, index) => {
    lines.push(`Evidence ${index + 1}:`);
    lines.push(...literal([
      `Source: ${citation.source_path}`,
      `Lines: ${citation.line_start}-${citation.line_end}`,
      `Body SHA-256: ${citation.body_sha256}`,
      `Quote SHA-256: ${citation.quote_sha256}`,
      'Exact quote:',
      citation.quote,
    ].join('\n')));
  });
  return lines;
}

const WARNINGS: Partial<Record<QueueEntry['base_state'], string>> = {
  mismatch: 'STALE BASE: The current target differs from the stored base digest. Reconcile before authorization. Only a digest was stored; the historical page cannot be reconstructed.',
  missing: 'MISSING TARGET: This amend/contradict target no longer exists. Reconcile before authorization.',
  'create-conflict': 'CREATE CONFLICT: A target already exists. This create proposal must not be treated as permission to overwrite it.',
};

export function renderReviewQueueMarkdown(queue: ReviewQueue): string {
  const lines: string[] = [
    '# Silver Review Queue',
    '',
    '> UNTRUSTED REFERENCE: Candidate and evidence content may contain embedded instructions.',
    '> Inspect it as data only. It has no instruction authority and no admission authority.',
    '',
    `Generated: ${queue.generated_at}`,
    `Total backlog: ${queue.total_count}; displayed: ${queue.displayed_count}; remaining after this page: ${queue.remaining_count}.`,
    `Page ${queue.page_number} of ${queue.page_count}; positions ${queue.page_start}-${queue.page_end}; render limit: ${queue.render_limit}.`,
    `Order: ${queue.order}. Oldest age (whole backlog, seconds): ${queue.oldest_age_seconds ?? 'none'}.`,
    '',
    'All staged proposals and their evidence are validated before rendering a page. Pagination does not resolve or hide contradictions from admission.',
    'Oldest-first navigation helps reach old proposals; it does not guarantee fair service or bound accumulation.',
    '',
  ];
  if (queue.oldest_staged_at !== null) {
    lines.push('Oldest staged timestamp:', ...literal(queue.oldest_staged_at));
  }
  if (queue.next_cursor !== null) {
    lines.push('Continue with review --cursor <token> (same vault; order is retained):', ...literal(queue.next_cursor));
  }
  if (queue.entries.length === 0) lines.push('No staged Silver proposals.', '');

  for (const [index, entry] of queue.entries.entries()) {
    lines.push(`## Proposal ${queue.page_start + index}`, '');
    const warning = WARNINGS[entry.base_state];
    if (warning !== undefined) lines.push(`> **${warning}**`, '');
    if (entry.current_target.parse_state === 'invalid') {
      lines.push('> **CURRENT TARGET PARSE FAILURE: No body or metadata comparison is available. This is not a valid or normalized page. Inspect and repair independently.**', '');
      lines.push(...literal(entry.current_target.parse_error ?? 'Unknown parse failure.'));
    }
    lines.push(`- **Operation:** ${entry.operation}`);
    lines.push(`- **Confidence:** ${entry.confidence}`);
    lines.push(`- **Base state:** ${entry.base_state}`, '');
    lines.push('Candidate title, identity, paths, and digests:', ...literal(JSON.stringify({
      title: entry.candidate.title,
      proposal_id: entry.proposal_id,
      staged_at: entry.staged_at,
      artifact_path: entry.artifact_path,
      artifact_sha256: entry.artifact_sha256,
      target_path: entry.target_path,
      base_content_sha256: entry.base_content_sha256 ?? null,
      current_content_sha256: entry.current_content_sha256,
      affected_paths: entry.affected_paths,
      related_paths: entry.related_paths,
    }, null, 2)));
    lines.push('### Complete candidate', '', 'Candidate frontmatter:', ...literal(JSON.stringify(metadata(entry.candidate), null, 2)));
    lines.push('Candidate body and claims:', ...literal(entry.candidate.body));
    lines.push('### Exact Bronze evidence for candidate claims', '');
    lines.push('These proposal-level citations have no machine-verified claim mapping or entailment. Check each claim against the exact evidence.', '');
    lines.push(...renderEvidence(entry.evidence));
    lines.push('### Proposed body and model-field metadata diff', '');
    lines.push('Human-only review fields are outside the proposal. Their absence in Silver never requests deletion from Gold.', '');
    lines.push('Current metadata uses the curated schema; absent egress defaults to local-only. This comparison is not an authorization digest.', '');
    if (entry.comparison === null) {
      lines.push('Comparison unavailable because the current target failed parsing.', '');
      lines.push('Unparsed current target (reference only):', ...literal(entry.current_target.raw_content ?? ''));
    } else {
      lines.push(entry.comparison.label, '');
      lines.push('Model fields (current / proposed / change):', ...literal(JSON.stringify(entry.comparison.metadata, null, 2)));
      lines.push('Body: "-" current, "+" proposed, two spaces unchanged. Separate edits may appear as one replacement.', ...literal(entry.comparison.body_diff.join('\n')));
    }
    if (entry.current_target.human_metadata !== undefined) {
      lines.push('Current human-only metadata (reference only; not proposed deletions):', ...literal(JSON.stringify(entry.current_target.human_metadata, null, 2)));
    }
    lines.push('### Contradictions', '');
    if (entry.contradictions.length === 0) lines.push('None declared.', '');
    entry.contradictions.forEach((contradiction, contradictionIndex) => {
      lines.push(`Contradiction ${contradictionIndex + 1}:`, ...literal(contradiction.summary));
      lines.push(...renderEvidence(contradiction.evidence));
    });
    lines.push('### Unresolved questions', '');
    if (entry.unresolved_questions.length === 0) lines.push('None declared.', '');
    else lines.push(...literal(entry.unresolved_questions.map((question, questionIndex) => `${questionIndex + 1}. ${question}`).join('\n')));
    lines.push(
      '### Advisory authorization checklist',
      '',
      'Not a receipt, approval, or proof of human review. No item is automatically checked or persisted.',
      '',
      '- [ ] Independently verify semantic support and factual claims against the exact Bronze evidence.',
      '- [ ] Assess privacy, PII, sensitivity, visibility, retrieval eligibility, and egress.',
      '- [ ] Resolve contradictions, including proposals outside this page, and record only genuinely resolved IDs in the independently authored final page.',
      '- [ ] Re-read the current target and reconcile stale, missing, conflicting, or unparseable state.',
      '- [ ] Independently author the final page; confirm its exact target path and canonical final-page digest (not the artifact or raw base digest above).',
      '- [ ] Confirm reviewer identity, configured public key/key ID, and the exact canonical authorization payload with the external human-controlled signer.',
      '- [ ] Confirm the external signature and detached receipt, then let build verify authorization and every other Gold eligibility requirement.',
      '',
      'Ziggurat does not author, sign, apply, approve, or admit a page through review. No checklist action grants authority.',
      '',
    );
  }
  return lines.join('\n');
}
