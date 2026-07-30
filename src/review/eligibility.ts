import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as YAML from 'yaml';
import type { CuratedPage } from '../contracts/index.js';
import { sha256Text } from '../bronze/canonical.js';
import { collectUnresolvedContradictions } from './contradictions.js';

export interface EligibilityReport {
  eligible: boolean;
  reasons: string[];
  bronze_lineage: string[];
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
    content = await readFile(join(root, sourcePath), 'utf8');
  } catch {
    return `lineage: ${sourcePath} is not readable`;
  }

  const split = splitBronzeFile(content.replace(/\r\n/g, '\n'));
  if (split === null) return `lineage: ${sourcePath} is not a valid Bronze file`;

  let frontmatter: unknown;
  try {
    frontmatter = YAML.parse(split.yamlText);
  } catch {
    return `lineage: ${sourcePath} has unparseable frontmatter`;
  }

  const rec = frontmatter as Record<string, unknown>;
  if (typeof rec['sha256'] !== 'string') return `lineage: ${sourcePath} has no sha256 in frontmatter`;

  const actual = sha256Text(split.body);
  if (actual !== rec['sha256']) return `lineage: ${sourcePath} body hash mismatch`;

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
  asOf: Date = new Date(),
): Promise<EligibilityReport> {
  const reasons: string[] = [];
  const bronze_lineage: string[] = [];

  if (page.status !== 'reviewed') reasons.push('status: reviewed required');
  if (page.retrieval_eligible !== true) reasons.push('retrieval_eligible required');
  if (page.pii !== 'false') reasons.push('pii: false required');
  if (page.sensitivity === 'restricted') reasons.push('sensitivity: restricted not permitted');
  if (page.egress !== 'permitted') reasons.push('egress: permitted required');
  if (!page.reviewed_by) reasons.push('reviewed_by: required');
  if (!page.reviewed_at) reasons.push('reviewed_at: required');
  if (!page.last_verified) reasons.push('last_verified: required');

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

  const contradictions = await collectUnresolvedContradictions(root, pagePath);
  if (contradictions.length > 0) {
    reasons.push(`contradictions: ${contradictions.length} unresolved`);
  }

  reasons.sort();

  return { eligible: reasons.length === 0, reasons, bronze_lineage };
}
