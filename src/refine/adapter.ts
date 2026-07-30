const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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
    source_path: { type: 'string', minLength: 1 },
    body_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    line_start: { type: 'integer', minimum: 1 },
    line_end: { type: 'integer', minimum: 1 },
    quote: { type: 'string', minLength: 1 },
    quote_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
};

/** JSON Schema for RefinementProposal, sent in structured-output requests. Zod parse remains authoritative. */
export const RefinementProposalJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'operation',
    'target_path',
    'evidence',
    'confidence',
    'affected_paths',
    'related_paths',
    'unresolved_questions',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    operation: { type: 'string', enum: ['create', 'amend', 'contradict'] },
    target_path: { type: 'string', pattern: '^knowledge/.+' },
    evidence: {
      type: 'array',
      minItems: 1,
      items: evidenceCitationJsonSchema,
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    affected_paths: { type: 'array', items: { type: 'string', minLength: 1 } },
    related_paths: { type: 'array', items: { type: 'string', minLength: 1 } },
    unresolved_questions: { type: 'array', items: { type: 'string' } },
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
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `LoopbackChatAdapter: only loopback addresses are permitted, got ${url.hostname}`,
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
