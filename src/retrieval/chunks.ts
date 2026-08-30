import { sha256Text } from '../bronze/canonical.js';
import type { CuratedPage } from '../contracts/index.js';
import type {
  GoldChunk,
  ProfileChunk,
} from '../contracts/gold-index.js';
import type { VerifiedAuthorization } from '../authorization/verify.js';

function chunkId(profile: string, path: string, body: string): string {
  return sha256Text(`${profile}\0${path}\0${sha256Text(body)}`);
}

export function makeGoldChunk(
  path: string,
  page: CuratedPage,
  pageBody: string,
  bronzeLineage: Array<{ path: string; sha256: string }>,
  authorization: VerifiedAuthorization,
): GoldChunk {
  return {
    id: chunkId('communion', path, pageBody),
    path,
    heading: page.title,
    body: pageBody,
    bronze_lineage: bronzeLineage,
    profile: 'communion',
    tier: 'gold',
    status: 'reviewed',
    content_role: 'reference',
    instruction_authority: 'none',
    authorization: {
      receipt_path: authorization.receipt_path,
      receipt_sha256: authorization.receipt_sha256,
      content_sha256: authorization.content_sha256,
      reviewer_id: authorization.reviewer_id,
      reviewed_at: authorization.reviewed_at,
      key_id: authorization.key_id,
      algorithm: authorization.algorithm,
      decision: authorization.decision,
    },
  };
}

export function makeProfileChunk(
  path: string,
  heading: string,
  body: string,
  tier: ProfileChunk['tier'],
  status: ProfileChunk['status'],
  profile: ProfileChunk['profile'],
  provenance: ProfileChunk['provenance'],
): ProfileChunk {
  return {
    id: chunkId(profile, path, body),
    path,
    heading,
    body,
    tier,
    status,
    profile,
    content_role: 'reference',
    instruction_authority: 'none',
    provenance,
  };
}
