import { randomUUID } from 'node:crypto';
import type { AccessProfile } from '../contracts/index.js';
import type { GoldIndex, ProfileIndex, SearchResult } from '../contracts/gold-index.js';
import { sha256Text } from '../bronze/canonical.js';
import { loadGoldIndex, searchGoldIndex } from '../retrieval/gold-index.js';
import { loadProfileIndex, searchProfileIndex } from '../retrieval/profile-index.js';
import { bm25Search } from '../retrieval/bm25.js';

export interface CitationPayload {
  path: string;
  heading: string;
  profile: AccessProfile;
  body: string;
  body_sha256: string;
  bronze_lineage: Array<{ path: string; sha256: string }>;
  status: string;
  tier: string;
}

export interface SearchHit extends SearchResult {
  citation_id: string;
}

/**
 * Per-session, profile-bound citation store.
 * Citation IDs are opaque UUIDs valid only within the same instance.
 * Profile is fixed at creation and cannot be overridden by callers.
 */
export class ContextAccess {
  private readonly citations = new Map<string, CitationPayload>();
  private readonly initFingerprint: string;

  constructor(
    private readonly root: string,
    private readonly profile: AccessProfile,
    private readonly index: GoldIndex | ProfileIndex,
  ) {
    this.initFingerprint = index.corpus_fingerprint;
  }

  get accessProfile(): AccessProfile {
    return this.profile;
  }

  /**
   * Searches the index and issues citation IDs for returned results.
   * Rejects with an error if the on-disk index fingerprint has changed since creation.
   */
  async search(query: string): Promise<SearchHit[]> {
    const current = await this.reloadIndex();
    if (current.corpus_fingerprint !== this.initFingerprint) {
      throw new Error(
        `Index fingerprint changed since this access session was created. Rebuild may be required. (${this.profile})`,
      );
    }

    const results = this.runSearch(current, query);
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
      };
      this.citations.set(id, payload);
      hits.push({ ...result, citation_id: id });
    }

    return hits;
  }

  /**
   * Returns the citation payload for an ID issued by this access instance.
   * Throws if the ID is unknown, forged, or from a different instance.
   */
  read(citationId: string): CitationPayload {
    const payload = this.citations.get(citationId);
    if (payload === undefined) {
      throw new Error(`Unknown citation ID. IDs are valid only within the issuing access session.`);
    }
    return payload;
  }

  private async reloadIndex(): Promise<GoldIndex | ProfileIndex> {
    if (this.profile === 'communion') return loadGoldIndex(this.root);
    return loadProfileIndex(this.root, this.profile);
  }

  private runSearch(index: GoldIndex | ProfileIndex, query: string): SearchResult[] {
    if (this.profile === 'communion') {
      const ranked = bm25Search(query, (index as GoldIndex).bm25);
      const chunkMap = new Map((index as GoldIndex).chunks.map(c => [c.id, c]));
      const results: SearchResult[] = [];
      for (const { id, score } of ranked) {
        const chunk = chunkMap.get(id);
        if (chunk === undefined) continue;
        results.push({ chunk_id: id, path: chunk.path, heading: chunk.heading, score, tier: chunk.tier, profile: chunk.profile, status: chunk.status, body: chunk.body });
      }
      return results;
    }
    return searchProfileIndex(index as ProfileIndex, query);
  }

  private extractLineage(index: GoldIndex | ProfileIndex, chunkId: string): Array<{ path: string; sha256: string }> {
    if (this.profile === 'communion') {
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
export async function createContextAccess(root: string, profile: AccessProfile): Promise<ContextAccess> {
  let index: GoldIndex | ProfileIndex;
  if (profile === 'communion') {
    index = await loadGoldIndex(root);
  } else {
    index = await loadProfileIndex(root, profile);
  }
  return new ContextAccess(root, profile, index);
}
