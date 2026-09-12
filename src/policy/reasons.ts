/** Stable machine codes are independent of display text and signed receipt bytes. */
export type PolicyReasonCode =
  | 'authorization.receipt-schema-invalid'
  | 'authorization.receipt-unreadable'
  | 'authorization.target-mismatch'
  | 'authorization.content-mismatch'
  | 'authorization.reviewer-mismatch'
  | 'authorization.reviewed-at-mismatch'
  | 'authorization.key-untrusted'
  | 'authorization.key-algorithm'
  | 'authorization.signature-encoding'
  | 'authorization.signature-invalid'
  | 'authorization.key-invalid'
  | 'gold.status'
  | 'gold.retrieval-eligible'
  | 'gold.pii'
  | 'gold.sensitivity'
  | 'gold.egress'
  | 'gold.reviewer-required'
  | 'gold.reviewed-at-required'
  | 'gold.reviewed-at-invalid'
  | 'gold.reviewed-at-future'
  | 'gold.last-verified-required'
  | 'gold.last-verified-invalid'
  | 'gold.last-verified-future'
  | 'gold.last-verified-stale'
  | 'gold.review-after-invalid'
  | 'gold.review-after-due'
  | 'gold.sources-required'
  | 'lineage.path-invalid'
  | 'lineage.unreadable'
  | 'lineage.missing-frontmatter'
  | 'lineage.invalid-yaml'
  | 'lineage.schema-invalid'
  | 'lineage.hash-mismatch'
  | 'gold.contradictions-unresolved'
  | 'gold.contradictions-unverifiable'
  | 'model-source.pii'
  | 'model-source.sensitivity'
  | 'model-source.hash-unverified';

export interface PolicyReason {
  code: PolicyReasonCode;
  message: string;
  /** A schema field, never a rejected value or an unrecognized input key. */
  field?: string;
  /** Vault-relative artifact path; consumers must render it as inert data. */
  path?: string;
}
