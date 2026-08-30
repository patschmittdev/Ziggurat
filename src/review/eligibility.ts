import { readFile } from 'node:fs/promises';
import * as YAML from 'yaml';
import type { CuratedPage } from '../contracts/index.js';
import { BronzeRecordSchema } from '../contracts/index.js';
import { sha256Text } from '../bronze/canonical.js';
import {
  collectUnresolvedContradictions,
  unresolvedContradictionsFromIndex,
} from './contradictions.js';
import type { ContradictionIndex } from './contradictions.js';
import { verifyPageAuthorization } from '../authorization/verify.js';
import type { VerifiedAuthorization } from '../authorization/verify.js';
import {
  parseZigguratConfig,
} from '../contracts/config.js';
import type { ZigguratConfig } from '../contracts/config.js';
import { resolveBronzeSourcePath } from '../refine/evidence.js';

export interface EligibilityReport {
  eligible: boolean;
  reasons: string[];
  bronze_lineage: string[];
  authorization?: VerifiedAuthorization;
}

interface BronzeSplit {
  yamlText: string;
  body: string;
}

function splitBronzeFile(content: string): BronzeSplit | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return { yamlText: afterOpen.slice(0, closeIdx), body: afterOpen.slice(closeIdx + 5) };
}

function isNormalizedBronzePath(s: string): boolean {
  if (!s.startsWith('bronze/') || s.length <= 'bronze/'.length) return false;
  if (s.includes('\\') || s.startsWith('/')) return false;
  return s.split('/').every(p => p !== '' && p !== '.' && p !== '..');
}

async function verifyBronzeSource(root: string, sourcePath: string): Promise<string | null> {
  if (!isNormalizedBronzePath(sourcePath)) return `lineage: ${sourcePath} is not a valid Bronze path`;

  let content: string;
  try {
    content = await readFile(await resolveBronzeSourcePath(root, sourcePath), 'utf8');
  } catch {
    return `lineage: ${sourcePath} is not readable within Bronze`;
  }

  const split = splitBronzeFile(content.replace(/\r\n/g, '\n'));
  if (split === null) return `lineage: ${sourcePath} is not a valid Bronze file`;

  let frontmatter: unknown;
  try {
    frontmatter = YAML.parse(split.yamlText);
  } catch {
    return `lineage: ${sourcePath} has unparseable frontmatter`;
  }

  const record = BronzeRecordSchema.safeParse(frontmatter);
  if (!record.success) return `lineage: ${sourcePath} has invalid Bronze frontmatter`;

  const actual = sha256Text(split.body);
  if (actual !== record.data.sha256) return `lineage: ${sourcePath} body hash mismatch`;

  return null;
}

/**
 * Reports every reason a page fails Gold eligibility. Accumulates all failures.
 * Reasons are returned in lexical order.
 */
export async function goldEligibilityReport(
  root: string,
  pagePath: string,
  page: CuratedPage,
  pageBody: string,
  asOf: Date = new Date(),
  suppliedConfig?: ZigguratConfig,
  contradictionIndex?: ContradictionIndex,
): Promise<EligibilityReport> {
  const reasons: string[] = [];
  const bronze_lineage: string[] = [];
  const config = suppliedConfig ?? await parseZigguratConfig(root);

  if (page.status !== 'reviewed') reasons.push('status: reviewed required');
  if (page.retrieval_eligible !== true) reasons.push('retrieval_eligible required');
  if (page.pii !== 'false') reasons.push('pii: false required');
  if (page.sensitivity === 'restricted') reasons.push('sensitivity: restricted not permitted');
  // Missing egress resolves to local-only via the schema default, so a page that never
  // declared one gets this explicit repair instruction instead of vanishing at parse.
  if (page.egress !== 'approved-cloud') reasons.push('egress: approved-cloud required');
  if (!page.reviewed_by) reasons.push('reviewed_by: required');
  if (!page.reviewed_at) reasons.push('reviewed_at: required');
  if (!page.last_verified) reasons.push('last_verified: required');
  if (page.reviewed_at !== undefined) {
    const reviewedAt = new Date(page.reviewed_at);
    if (Number.isNaN(reviewedAt.getTime())) {
      reasons.push('reviewed_at: invalid date');
    } else if (reviewedAt > asOf) {
      reasons.push('reviewed_at: future date');
    }
  }
  if (page.last_verified !== undefined) {
    const verifiedAt = new Date(page.last_verified);
    if (Number.isNaN(verifiedAt.getTime())) {
      reasons.push('last_verified: invalid date');
    } else if (verifiedAt > asOf) {
      reasons.push('last_verified: future date');
    } else if (asOf.getTime() - verifiedAt.getTime() > 90 * 24 * 60 * 60 * 1000) {
      reasons.push('last_verified: page is stale');
    }
  }

  const authorizationReport = await verifyPageAuthorization(
    root,
    pagePath,
    page,
    pageBody,
    config,
  );
  for (const reason of authorizationReport.reasons) {
    reasons.push(`authorization: ${reason}`);
  }

  if (page.review_after !== undefined) {
    const ra = new Date(page.review_after);
    if (Number.isNaN(ra.getTime())) {
      reasons.push('review_after: invalid date');
    } else if (ra <= asOf) {
      reasons.push('review_after: re-review required');
    }
  }

  if (page.sources.length === 0) {
    reasons.push('sources: non-empty required');
  } else {
    for (const src of page.sources) {
      const err = await verifyBronzeSource(root, src);
      if (err !== null) {
        reasons.push(err);
      } else {
        bronze_lineage.push(src);
      }
    }
  }

  // A scan failure means contradiction state is unknown, which must exclude the page
  // rather than propagate and abort the whole build.
  try {
    const resolved = authorizationReport.valid ? (page.resolved_proposals ?? []) : [];
    const contradictions = contradictionIndex === undefined
      ? await collectUnresolvedContradictions(root, pagePath, resolved)
      : unresolvedContradictionsFromIndex(contradictionIndex, pagePath, resolved);
    if (contradictions.length > 0) {
      reasons.push(`contradictions: ${contradictions.length} unresolved`);
    }
  } catch (error) {
    reasons.push(
      `contradictions: state unverifiable (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  reasons.sort();

  return {
    eligible: reasons.length === 0,
    reasons,
    bronze_lineage,
    ...(authorizationReport.authorization === undefined
      ? {}
      : { authorization: authorizationReport.authorization }),
  };
}
