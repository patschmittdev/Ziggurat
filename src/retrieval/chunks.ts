import type { CuratedPage } from '../contracts/index.js';
import type { GoldChunk, ProfileChunk } from '../contracts/gold-index.js';
import { randomUUID } from 'node:crypto';

/**
 * Creates a Gold chunk from a reviewed Gold page.
 * Body is the full page text (title + content).
 * PII must already be verified as false by the caller.
 */
export function makeGoldChunk(
  path: string,
  page: CuratedPage,
  pageBody: string,
  bronzeLineage: Array<{ path: string; sha256: string }>,
): GoldChunk {
  return {
    id: randomUUID(),
    path,
    heading: page.title,
    body: pageBody,
    bronze_lineage: bronzeLineage,
    profile: 'communion',
    tier: 'gold',
    status: 'reviewed',
  };
}

/**
 * Creates a profile chunk for the review or evidence index.
 * PII must already be verified as false/safe by the caller.
 */
export function makeProfileChunk(
  path: string,
  heading: string,
  body: string,
  tier: ProfileChunk['tier'],
  status: string,
  profile: ProfileChunk['profile'],
): ProfileChunk {
  return {
    id: randomUUID(),
    path,
    heading,
    body,
    tier,
    status,
    profile,
  };
}
