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
 * Adapter resource limits.
 *
 * These are deliberately conservative and fixed in code rather than configurable: a
 * configurable ceiling is an attacker-reachable knob once configuration is writable,
 * and the refine pathway has no legitimate need for an unbounded response.
 */
export const ADAPTER_LIMITS = {
  /** Whole-request deadline, including connect, headers, and body streaming. */
  requestTimeoutMs: 30_000,
  /** Maximum bytes accepted from the model endpoint before the response is refused. */
  maxResponseBytes: 1_048_576,
  /** Maximum serialized request body sent to the model endpoint. */
  maxRequestBytes: 1_048_576,
} as const;

function assertLoopbackUrl(endpoint: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`${label}: endpoint is not a valid URL: ${endpoint}`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `${label}: endpoint must be http: with a loopback host (localhost/127.0.0.1/::1), got ${endpoint}`,
    );
  }
  return url;
}

/**
 * Reads a response body with a hard byte ceiling.
 *
 * `response.text()` buffers whatever the peer sends, so a hostile or broken endpoint
 * on the loopback interface can exhaust memory with a single reply. Streaming with a
 * running total fails closed at the limit and cancels the body instead.
 */
async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > limit) {
      throw new Error(
        `LoopbackChatAdapter: response declares ${declaredBytes} bytes, exceeding the ${limit} byte limit`,
      );
    }
  }

  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new Error(
          `LoopbackChatAdapter: response exceeded the ${limit} byte limit`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

/** Per-instance overrides for the adapter's resource ceilings. */
export interface LoopbackChatAdapterOptions {
  /** Whole-request deadline in milliseconds. Defaults to `ADAPTER_LIMITS.requestTimeoutMs`. */
  readonly requestTimeoutMs?: number;
  /** Response byte ceiling. Defaults to `ADAPTER_LIMITS.maxResponseBytes`. */
  readonly maxResponseBytes?: number;
}

function boundedLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`LoopbackChatAdapter: ${label} must be a positive integer`);
  }
  return value;
}

/**
 * Sends chat-completion requests to a loopback HTTP endpoint.
 *
 * Construction fails if the endpoint is not a loopback address. Redirects are never
 * followed: a loopback endpoint that answers with `Location: https://evil.example`
 * would otherwise turn the adapter into a server-side request forgery primitive that
 * ships prompt content off the machine. A redirect response is refused before the
 * destination is contacted, and every request is bounded by an explicit timeout and
 * request/response size ceilings.
 */
export class LoopbackChatAdapter implements StructuredChatAdapter {
  private readonly endpoint: string;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(endpoint: string, options: LoopbackChatAdapterOptions = {}) {
    assertLoopbackUrl(endpoint, 'LoopbackChatAdapter');
    this.endpoint = endpoint;
    this.requestTimeoutMs = boundedLimit(
      options.requestTimeoutMs, ADAPTER_LIMITS.requestTimeoutMs, 'requestTimeoutMs',
    );
    this.maxResponseBytes = boundedLimit(
      options.maxResponseBytes, ADAPTER_LIMITS.maxResponseBytes, 'maxResponseBytes',
    );
  }

  async completeJson(messages: readonly ChatMessage[]): Promise<unknown> {
    const requestBody = JSON.stringify({
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ziggurat_refinement_proposal',
          strict: true,
          schema: RefinementProposalJsonSchema,
        },
      },
    });

    const requestBytes = Buffer.byteLength(requestBody, 'utf8');
    if (requestBytes > ADAPTER_LIMITS.maxRequestBytes) {
      throw new Error(
        `LoopbackChatAdapter: request body is ${requestBytes} bytes, exceeding the `
        + `${ADAPTER_LIMITS.maxRequestBytes} byte limit`,
      );
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        // 'manual' surfaces the redirect as an ordinary response so it can be refused
        // with an actionable message. The destination is never fetched.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `LoopbackChatAdapter: request to ${this.endpoint} failed or timed out after `
        + `${this.requestTimeoutMs}ms: ${reason}`,
      );
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      const location = response.headers.get('location');
      throw new Error(
        `LoopbackChatAdapter: refusing HTTP ${response.status} redirect from ${this.endpoint}`
        + `${location === null ? '' : ` to ${location}`}. Redirects are not followed.`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `LoopbackChatAdapter: HTTP ${response.status} from ${this.endpoint}`,
      );
    }

    const text = await readBoundedText(response, this.maxResponseBytes);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `LoopbackChatAdapter: response from ${this.endpoint} is not valid JSON`,
      );
    }
  }
}
