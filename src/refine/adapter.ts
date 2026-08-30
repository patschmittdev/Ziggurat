const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const BRONZE_PATH_PATTERN =
  '^bronze/(?!\\.{1,2}(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/\\.{1,2}(?:/|$))'
  + '[^\\u0000-\\u001f\\u007f-\\u009f]+$';
const VAULT_PATH_PATTERN =
  '^(?!/)(?![A-Za-z]:)(?!\\.{1,2}(?:/|$))(?!.*//)(?!.*\\\\)'
  + '(?!.*\\/\\.{1,2}(?:/|$))[^\\u0000-\\u001f\\u007f-\\u009f]+$';
const KNOWLEDGE_PATH_PATTERN =
  '^knowledge/(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$))'
  + '(?!.*\\.\\.md$)[a-z0-9][a-z0-9._-]*\\.md$';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StructuredChatAdapter {
  completeJson(messages: readonly ChatMessage[]): Promise<unknown>;
}

const evidenceCitationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source_path', 'body_sha256', 'line_start', 'line_end', 'quote', 'quote_sha256'],
  properties: {
    source_path: { type: 'string', pattern: BRONZE_PATH_PATTERN },
    body_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    line_start: { type: 'integer', minimum: 1 },
    line_end: { type: 'integer', minimum: 1 },
    quote: { type: 'string', minLength: 1 },
    quote_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
};

const candidateJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'title',
    'type',
    'sources',
    'confidence',
    'retrieval_eligible',
    'pii',
    'sensitivity',
    'visibility',
    'egress',
    'body',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    title: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    sources: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: BRONZE_PATH_PATTERN },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    retrieval_eligible: { type: 'boolean' },
    pii: { type: 'string', enum: ['true', 'false', 'unknown'] },
    sensitivity: { type: 'string', enum: ['public', 'internal', 'restricted'] },
    visibility: { type: 'string', minLength: 1 },
    egress: { type: 'string', enum: ['local-only', 'approved-cloud'] },
    body: { type: 'string', minLength: 1 },
  },
};

/** JSON Schema for RefinementProposal, sent in structured-output requests. Zod parse remains authoritative. */
export const RefinementProposalJsonSchema = {
  type: 'object',
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { operation: { const: 'create' } } },
      then: { not: { required: ['base_content_sha256'] } },
      else: { required: ['base_content_sha256'] },
    },
  ],
  required: [
    'schema_version',
    'operation',
    'target_path',
    'candidate',
    'evidence',
    'contradictions',
    'confidence',
    'affected_paths',
    'related_paths',
    'unresolved_questions',
  ],
  properties: {
    schema_version: { type: 'integer', const: 2 },
    operation: { type: 'string', enum: ['create', 'amend', 'contradict'] },
    target_path: {
      type: 'string',
      pattern: KNOWLEDGE_PATH_PATTERN,
    },
    candidate: candidateJsonSchema,
    base_content_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    evidence: {
      type: 'array',
      minItems: 1,
      items: evidenceCitationJsonSchema,
    },
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'evidence'],
        properties: {
          summary: { type: 'string', minLength: 1 },
          evidence: {
            type: 'array',
            minItems: 1,
            items: evidenceCitationJsonSchema,
          },
        },
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    affected_paths: { type: 'array', items: { type: 'string', pattern: VAULT_PATH_PATTERN } },
    related_paths: { type: 'array', items: { type: 'string', pattern: VAULT_PATH_PATTERN } },
    unresolved_questions: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

/**
 * Sends chat-completion requests to a loopback HTTP endpoint.
 * Construction fails if the endpoint is not a loopback address.
 */
export class LoopbackChatAdapter implements StructuredChatAdapter {
  private readonly endpoint: string;

  constructor(endpoint: string) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `LoopbackChatAdapter: endpoint must be http: with a loopback host (localhost/127.0.0.1/::1), got ${endpoint}`,
      );
    }
    this.endpoint = endpoint;
  }

  async completeJson(messages: readonly ChatMessage[]): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ziggurat_refinement_proposal',
            strict: true,
            schema: RefinementProposalJsonSchema,
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(
        `LoopbackChatAdapter: HTTP ${response.status} from ${this.endpoint}`,
      );
    }
    return response.json() as Promise<unknown>;
  }
}
