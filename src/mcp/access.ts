import { randomUUID } from 'node:crypto';
import type { AccessProfile } from '../contracts/index.js';
import type { GoldIndex, ProfileIndex, SearchResult } from '../contracts/gold-index.js';
import { sha256Text } from '../bronze/canonical.js';
import { loadGoldIndex } from '../retrieval/gold-index.js';
import { loadProfileIndex, searchProfileIndex } from '../retrieval/profile-index.js';
import { bm25Search } from '../retrieval/bm25.js';
import { assertIndexTrustworthy } from '../retrieval/verify.js';

export interface CitationPayload {
  path: string;
  heading: string;
  profile: AccessProfile;
  body: string;
  body_sha256: string;
  bronze_lineage: Array<{ path: string; sha256: string }>;
  status: string;
  tier: string;
  content_role: 'reference';
  instruction_authority: 'none';
}

export interface SearchHit extends SearchResult {
  citation_id: string;
}

interface StoredCitation {
  payload: CitationPayload;
  chunk_id: string;
  corpus_fingerprint: string;
}

/**
 * Retrieval bounds for a single access session.
 *
 * A long-lived MCP server holds citations in process memory for the lifetime of the
 * session, so an unbounded store lets a client with only read tools grow local memory
 * without limit. These ceilings are conservative, fixed, and documented rather than
 * configurable, because the only party who benefits from raising them is a caller
 * trying to exhaust the host.
 */
export const ACCESS_LIMITS = {
  /** Longest accepted query string. Longer queries are refused, never truncated. */
  maxQueryChars: 1_024,
  /** Highest-ranked results returned by one search. Lower-ranked hits are dropped. */
  maxSearchResults: 20,
  /** Citations retained per session. The oldest are revoked first when full. */
  maxSessionCitations: 200,
} as const;

export type AccessLimits = { -readonly [K in keyof typeof ACCESS_LIMITS]: number };

function resolveLimits(overrides: Partial<AccessLimits> | undefined): AccessLimits {
  const resolved: AccessLimits = { ...ACCESS_LIMITS };
  if (overrides === undefined) return resolved;
  for (const key of Object.keys(resolved) as Array<keyof AccessLimits>) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`ContextAccess: ${key} must be a positive integer`);
    }
    resolved[key] = value;
  }
  // A single search inserts up to maxSearchResults citations and only then evicts down
  // to maxSessionCitations. If the result ceiling exceeded the session ceiling, that
  // eviction would revoke citation IDs the same call is still returning, so search()
  // would hand back IDs that read() rejects. Reject the combination instead.
  if (resolved.maxSearchResults > resolved.maxSessionCitations) {
    throw new Error(
      `ContextAccess: maxSearchResults (${resolved.maxSearchResults}) must not exceed `
      + `maxSessionCitations (${resolved.maxSessionCitations})`,
    );
  }
  return resolved;
}

/**
 * Per-session, profile-bound citation store.
 * Citation IDs are opaque UUIDs valid only within the same instance.
 * Profile is fixed at creation and cannot be overridden by callers.
 */
export class ContextAccess {
  private readonly citations = new Map<string, StoredCitation>();
  private readonly limits: AccessLimits;

  constructor(
    private readonly root: string,
    private readonly profile: AccessProfile,
    _initialIndex: GoldIndex | ProfileIndex,
    limits?: Partial<AccessLimits>,
  ) {
    this.limits = resolveLimits(limits);
  }

  get accessProfile(): AccessProfile {
    return this.profile;
  }

  /**
   * Searches the index and issues citation IDs for returned results.
   *
   * Re-verifies before every query rather than trusting the startup check: the corpus
   * can change while a server is running, and comparing the index's stored fingerprint
   * to itself would accept both a stale corpus and injected chunks.
   */
  async search(query: string): Promise<SearchHit[]> {
    if (query.length === 0) {
      throw new Error('Query must not be empty.');
    }
    if (query.length > this.limits.maxQueryChars) {
      throw new Error(
        `Query is ${query.length} characters, exceeding the ${this.limits.maxQueryChars} character limit.`,
      );
    }

    const current = await this.reloadIndex();
    await assertIndexTrustworthy(this.root, this.profile, current);

    const results = this.runSearch(current, query).slice(0, this.limits.maxSearchResults);
    const hits: SearchHit[] = [];

    for (const result of results) {
      const id = randomUUID();
      const payload: CitationPayload = {
        path: result.path,
        heading: result.heading,
        profile: this.profile,
        body: result.body,
        body_sha256: sha256Text(result.body),
        bronze_lineage: this.extractLineage(current, result.chunk_id),
        status: result.status,
        tier: result.tier,
        content_role: result.content_role,
        instruction_authority: result.instruction_authority,
      };
      this.citations.set(id, {
        payload,
        chunk_id: result.chunk_id,
        corpus_fingerprint: current.corpus_fingerprint,
      });
      hits.push({ ...result, citation_id: id });
    }

    this.evictOldestCitations();
    return hits;
  }

  /**
   * Drops the oldest citations once the session store is full.
   *
   * Eviction revokes: a dropped ID stops resolving and `read` fails closed with the
   * same unknown-citation error as a forged ID. Bounded memory is preferred over an
   * unbounded store that a client can grow one search at a time.
   */
  private evictOldestCitations(): void {
    if (this.citations.size <= this.limits.maxSessionCitations) return;
    const excess = this.citations.size - this.limits.maxSessionCitations;
    let removed = 0;
    for (const key of this.citations.keys()) {
      if (removed >= excess) break;
      this.citations.delete(key);
      removed += 1;
    }
  }

  /**
   * Returns the citation payload for an ID issued by this access instance.
   * Throws if the ID is unknown, forged, or from a different instance.
   */
  async read(citationId: string): Promise<CitationPayload> {
    const current = await this.reloadIndex();
    await assertIndexTrustworthy(this.root, this.profile, current);
    const stored = this.citations.get(citationId);
    if (stored === undefined) {
      throw new Error(`Unknown citation ID. IDs are valid only within the issuing access session.`);
    }
    if (stored.corpus_fingerprint !== current.corpus_fingerprint) {
      throw new Error('Citation was issued from a different corpus state and is no longer valid.');
    }
    const currentChunk = current.chunks.find(chunk => chunk.id === stored.chunk_id);
    if (
      currentChunk === undefined
      || currentChunk.path !== stored.payload.path
      || sha256Text(currentChunk.body) !== stored.payload.body_sha256
    ) {
      throw new Error('Citation content is no longer present in the verified index.');
    }
    return stored.payload;
  }

  private async reloadIndex(): Promise<GoldIndex | ProfileIndex> {
    if (this.profile === 'gold') return loadGoldIndex(this.root);
    return loadProfileIndex(this.root, this.profile);
  }

  private runSearch(index: GoldIndex | ProfileIndex, query: string): SearchResult[] {
    if (this.profile === 'gold') {
      const ranked = bm25Search(query, (index as GoldIndex).bm25);
      const chunkMap = new Map((index as GoldIndex).chunks.map(c => [c.id, c]));
      const results: SearchResult[] = [];
      for (const { id, score } of ranked) {
        const chunk = chunkMap.get(id);
        if (chunk === undefined) continue;
        results.push({
          chunk_id: id,
          path: chunk.path,
          heading: chunk.heading,
          score,
          tier: chunk.tier,
          profile: chunk.profile,
          status: chunk.status,
          body: chunk.body,
          content_role: chunk.content_role,
          instruction_authority: chunk.instruction_authority,
        });
      }
      return results;
    }
    return searchProfileIndex(index as ProfileIndex, query);
  }

  private extractLineage(index: GoldIndex | ProfileIndex, chunkId: string): Array<{ path: string; sha256: string }> {
    if (this.profile === 'gold') {
      const chunk = (index as GoldIndex).chunks.find(c => c.id === chunkId);
      return chunk?.bronze_lineage ?? [];
    }
    return [];
  }
}

/**
 * Creates a profile-bound access instance by loading the appropriate index from disk.
 * Throws if the index does not exist or fails schema validation.
 */
export async function createContextAccess(
  root: string,
  profile: AccessProfile,
  limits?: Partial<AccessLimits>,
): Promise<ContextAccess> {
  let index: GoldIndex | ProfileIndex;
  if (profile === 'gold') {
    index = await loadGoldIndex(root);
  } else {
    index = await loadProfileIndex(root, profile);
  }
  // Refuse to start at all on a stale, tampered, or profile-mismatched index.
  await assertIndexTrustworthy(root, profile, index);
  return new ContextAccess(root, profile, index, limits);
}
