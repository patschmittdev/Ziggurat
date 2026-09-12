import type { CuratedPage } from '../contracts/index.js';
import { BronzeCorruptionError } from '../bronze/store.js';
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
import { BronzeDocumentError, createVerifiedBronzeReader } from '../refine/evidence.js';
import type { VerifiedBronzeReader } from '../refine/evidence.js';
import type { BronzeInput, CorpusRejection } from '../corpus/collect.js';
import type { PolicyReason, PolicyReasonCode } from '../policy/reasons.js';
import { isNormalizedRelativePath } from '../contracts/path.js';

export interface EligibilityReport {
  eligible: boolean;
  reasons: string[];
  reason_details: PolicyReason[];
  bronze_lineage: string[];
  verified_bronze_lineage: Array<{ path: string; sha256: string }>;
  authorization?: VerifiedAuthorization;
}

/** Only freshly collected inputs from this operation may be supplied; never persist. */
export interface GoldEligibilityContext {
  bronzeByPath: ReadonlyMap<string, BronzeInput>;
  bronzeRejectionsByPath: ReadonlyMap<string, CorpusRejection>;
  verifiedSources: Map<string, Promise<BronzeVerification>>;
  bronzeReader?: VerifiedBronzeReader;
}

export function createGoldEligibilityContext(
  bronze: readonly BronzeInput[] = [],
  rejected: readonly CorpusRejection[] = [],
  bronzeReader?: VerifiedBronzeReader,
): GoldEligibilityContext {
  return {
    bronzeByPath: new Map(bronze.map(record => [record.path, record])),
    bronzeRejectionsByPath: new Map(rejected.map(entry => [entry.path, entry])),
    verifiedSources: new Map(),
    ...(bronzeReader === undefined ? {} : { bronzeReader }),
  };
}

function isNormalizedBronzePath(s: string): boolean {
  if (!s.startsWith('bronze/') || s.length <= 'bronze/'.length) return false;
  return isNormalizedRelativePath(s);
}

type BronzeVerification =
  | { valid: true; sha256: string }
  | { valid: false; reason: PolicyReason; legacyMessage: string };

function lineageFailure(
  path: string,
  code: PolicyReasonCode,
  description: string,
): BronzeVerification {
  return {
    valid: false,
    reason: { code, message: `Bronze source ${description}`, field: 'sources', path },
    legacyMessage: `lineage: ${path} ${description}`,
  };
}

function rejectedLineage(
  path: string,
  reason: CorpusRejection['reason'],
): BronzeVerification {
  switch (reason) {
    case 'unreadable': return lineageFailure(path, 'lineage.unreadable', 'is not readable within Bronze');
    case 'missing-frontmatter': return lineageFailure(path, 'lineage.missing-frontmatter', 'is not a valid Bronze file');
    case 'invalid-yaml': return lineageFailure(path, 'lineage.invalid-yaml', 'has unparseable frontmatter');
    case 'schema-invalid': return lineageFailure(path, 'lineage.schema-invalid', 'has invalid Bronze frontmatter');
  }
}

async function verifyBronzeSource(
  root: string,
  sourcePath: string,
  context?: GoldEligibilityContext,
): Promise<BronzeVerification> {
  const cached = context?.verifiedSources.get(sourcePath);
  if (cached !== undefined) return cached;
  const result = verifyBronzeSourceUncached(root, sourcePath, context);
  context?.verifiedSources.set(sourcePath, result);
  return result;
}

async function verifyBronzeSourceUncached(
  root: string,
  sourcePath: string,
  context?: GoldEligibilityContext,
): Promise<BronzeVerification> {
  if (!isNormalizedBronzePath(sourcePath)) {
    return lineageFailure(sourcePath, 'lineage.path-invalid', 'is not a valid Bronze path');
  }
  if (context?.bronzeReader !== undefined) {
    return verifyWithBronzeReader(root, sourcePath, context.bronzeReader);
  }
  const rejected = context?.bronzeRejectionsByPath.get(sourcePath);
  if (rejected !== undefined) return rejectedLineage(sourcePath, rejected.reason);
  const collected = context?.bronzeByPath.get(sourcePath);
  if (collected !== undefined) {
    if (collected.rejection !== undefined) {
      return rejectedLineage(sourcePath, collected.rejection.reason);
    }
    return collected.hashVerified
      ? { valid: true, sha256: collected.sha256 }
      : lineageFailure(sourcePath, 'lineage.hash-mismatch', 'body hash mismatch');
  }

  return verifyWithBronzeReader(root, sourcePath, createVerifiedBronzeReader(root));
}

async function verifyWithBronzeReader(
  root: string,
  sourcePath: string,
  bronzeReader: VerifiedBronzeReader,
): Promise<BronzeVerification> {
  try {
    const source = await bronzeReader.read(root, sourcePath);
    return { valid: true, sha256: source.record.sha256 };
  } catch (error) {
    if (error instanceof BronzeDocumentError) return rejectedLineage(sourcePath, error.reason);
    if (error instanceof BronzeCorruptionError) {
      return lineageFailure(sourcePath, 'lineage.hash-mismatch', 'body hash mismatch');
    }
    return rejectedLineage(sourcePath, 'unreadable');
  }
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
  context?: GoldEligibilityContext,
): Promise<EligibilityReport> {
  const reasons: string[] = [];
  const reason_details: PolicyReason[] = [];
  const bronze_lineage: string[] = [];
  const verified_bronze_lineage: Array<{ path: string; sha256: string }> = [];
  const config = suppliedConfig ?? await parseZigguratConfig(root);
  const lineageContext = context
    ?? createGoldEligibilityContext([], [], createVerifiedBronzeReader(root));
  const reject = (code: PolicyReasonCode, message: string, field?: string): void => {
    reasons.push(message);
    reason_details.push({
      code, message, path: pagePath, ...(field === undefined ? {} : { field }),
    });
  };

  if (page.status !== 'reviewed') reject('gold.status', 'status: reviewed required', 'status');
  if (page.retrieval_eligible !== true) reject('gold.retrieval-eligible', 'retrieval_eligible required', 'retrieval_eligible');
  if (page.pii !== 'false') reject('gold.pii', 'pii: false required', 'pii');
  if (page.sensitivity === 'restricted') reject('gold.sensitivity', 'sensitivity: restricted not permitted', 'sensitivity');
  // Missing egress resolves to local-only via the schema default, so a page that never
  // declared one gets this explicit repair instruction instead of vanishing at parse.
  if (page.egress !== 'approved-cloud') reject('gold.egress', 'egress: approved-cloud required', 'egress');
  if (!page.reviewed_by) reject('gold.reviewer-required', 'reviewed_by: required', 'reviewed_by');
  if (!page.reviewed_at) reject('gold.reviewed-at-required', 'reviewed_at: required', 'reviewed_at');
  if (!page.last_verified) reject('gold.last-verified-required', 'last_verified: required', 'last_verified');
  if (page.reviewed_at !== undefined) {
    const reviewedAt = new Date(page.reviewed_at);
    if (Number.isNaN(reviewedAt.getTime())) {
      reject('gold.reviewed-at-invalid', 'reviewed_at: invalid date', 'reviewed_at');
    } else if (reviewedAt > asOf) {
      reject('gold.reviewed-at-future', 'reviewed_at: future date', 'reviewed_at');
    }
  }
  if (page.last_verified !== undefined) {
    const verifiedAt = new Date(page.last_verified);
    if (Number.isNaN(verifiedAt.getTime())) {
      reject('gold.last-verified-invalid', 'last_verified: invalid date', 'last_verified');
    } else if (verifiedAt > asOf) {
      reject('gold.last-verified-future', 'last_verified: future date', 'last_verified');
    } else if (asOf.getTime() - verifiedAt.getTime() > 90 * 24 * 60 * 60 * 1000) {
      reject('gold.last-verified-stale', 'last_verified: page is stale', 'last_verified');
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
  reason_details.push(...authorizationReport.reason_details);

  if (page.review_after !== undefined) {
    const ra = new Date(page.review_after);
    if (Number.isNaN(ra.getTime())) {
      reject('gold.review-after-invalid', 'review_after: invalid date', 'review_after');
    } else if (ra <= asOf) {
      reject('gold.review-after-due', 'review_after: re-review required', 'review_after');
    }
  }

  if (page.sources.length === 0) {
    reject('gold.sources-required', 'sources: non-empty required', 'sources');
  } else {
    for (const src of page.sources) {
      const verification = await verifyBronzeSource(root, src, lineageContext);
      if (!verification.valid) {
        reasons.push(verification.legacyMessage);
        reason_details.push(verification.reason);
      } else {
        bronze_lineage.push(src);
        verified_bronze_lineage.push({ path: src, sha256: verification.sha256 });
      }
    }
  }

  // A scan failure means contradiction state is unknown, which must exclude the page
  // rather than propagate and abort the whole build.
  try {
    const resolved = authorizationReport.valid ? (page.resolved_proposals ?? []) : [];
    const contradictions = contradictionIndex === undefined
      ? await collectUnresolvedContradictions(root, pagePath, resolved, lineageContext.bronzeReader)
      : unresolvedContradictionsFromIndex(contradictionIndex, pagePath, resolved);
    if (contradictions.length > 0) {
      reject('gold.contradictions-unresolved', `contradictions: ${contradictions.length} unresolved`, 'resolved_proposals');
    }
  } catch {
    reject('gold.contradictions-unverifiable', 'contradictions: state unverifiable', 'resolved_proposals');
  }

  reasons.sort();
  reason_details.sort((a, b) => {
    const left = `${a.code}\0${a.path ?? ''}\0${a.field ?? ''}`;
    const right = `${b.code}\0${b.path ?? ''}\0${b.field ?? ''}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return {
    eligible: reasons.length === 0,
    reasons,
    reason_details,
    bronze_lineage,
    verified_bronze_lineage,
    ...(authorizationReport.authorization === undefined
      ? {}
      : { authorization: authorizationReport.authorization }),
  };
}
