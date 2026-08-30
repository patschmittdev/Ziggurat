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
 * Per-session, profile-bound citation store.
 * Citation IDs are opaque UUIDs valid only within the same instance.
 * Profile is fixed at creation and cannot be overridden by callers.
 */
export class ContextAccess {
  private readonly citations = new Map<string, StoredCitation>();

  constructor(
    private readonly root: string,
    private readonly profile: AccessProfile,
    private readonly index: GoldIndex | ProfileIndex,
  ) {}

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
    const current = await this.reloadIndex();
    await assertIndexTrustworthy(this.root, this.profile, current);

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

    return hits;
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
  // Refuse to start at all on a stale, tampered, or profile-mismatched index.
  await assertIndexTrustworthy(root, profile, index);
  return new ContextAccess(root, profile, index);
}
