import { RefinementDraftJsonSchema } from '../contracts/refinement-draft.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StructuredChatAdapter {
  completeJson(messages: readonly ChatMessage[]): Promise<unknown>;
}

export type AdapterErrorCode =
  | 'malformed_envelope'
  | 'refusal'
  | 'truncation'
  | 'tool_calls'
  | 'invalid_json'
  | 'context_overflow'
  | 'http_error'
  | 'timeout'
  | 'request_limit'
  | 'response_limit'
  | 'redirect'
  | 'transport_error'
  | 'invalid_options'
  | 'invalid_endpoint';

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;

  constructor(code: AdapterErrorCode, message: string) {
    super(`LoopbackChatAdapter: ${message}`);
    this.name = 'AdapterError';
    this.code = code;
  }
}

/** Hard production ceilings; per-instance overrides may only lower these limits. */
export const ADAPTER_LIMITS = {
  /** Whole-request deadline, including connect, headers, and body streaming. */
  requestTimeoutMs: 30_000,
  maxResponseBytes: 1_048_576,
  maxRequestBytes: 1_048_576,
} as const;

export interface LoopbackChatAdapterOptions {
  /** Whole-request deadline, at most `ADAPTER_LIMITS.requestTimeoutMs`. */
  readonly requestTimeoutMs?: number;
  /** Response byte ceiling, at most `ADAPTER_LIMITS.maxResponseBytes`. */
  readonly maxResponseBytes?: number;
  /** Loaded llama-server model alias. Defaults to `ziggurat-refine`. */
  readonly model?: string;
  /** Output-token cap, from 1 through 4096. Defaults to 2048. */
  readonly maxTokens?: number;
  /** Optional unsigned 32-bit sampling seed. */
  readonly seed?: number;
  /** Opt-in synchronous diagnostics for complete bounded responses; never logged automatically. */
  readonly onResponse?: (response: { status: number; body: string }) => void;
}

function assertLoopbackUrl(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AdapterError('invalid_endpoint', 'endpoint is not a valid URL');
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AdapterError(
      'invalid_endpoint',
      'endpoint must be http: with a loopback host (localhost/127.0.0.1/::1)',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new AdapterError('invalid_endpoint', 'endpoint must not contain credentials');
  }
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  ceiling: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > ceiling) {
    throw new AdapterError(
      'invalid_options', `${label} must be a positive integer no greater than ${ceiling}`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdapterError('invalid_json', 'response is not valid JSON');
  }
}

function unwrapCompletion(envelope: unknown): unknown {
  if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) {
    throw new AdapterError('malformed_envelope', 'expected exactly one chat completion choice');
  }
  const choice: unknown = envelope.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || choice.message.role !== 'assistant') {
    throw new AdapterError('malformed_envelope', 'expected an assistant message');
  }
  const message = choice.message;
  if (message.refusal !== undefined && message.refusal !== null) {
    if (typeof message.refusal !== 'string') {
      throw new AdapterError('malformed_envelope', 'invalid assistant refusal field');
    }
    if (message.refusal !== '') {
      throw new AdapterError('refusal', 'model refused the request');
    }
  }
  if (message.tool_calls !== undefined && message.tool_calls !== null) {
    if (!Array.isArray(message.tool_calls)) {
      throw new AdapterError('malformed_envelope', 'invalid assistant tool_calls field');
    }
    if (message.tool_calls.length !== 0) {
      throw new AdapterError('tool_calls', 'model returned unexpected tool calls');
    }
  }
  if (message.function_call !== undefined && message.function_call !== null) {
    throw new AdapterError('tool_calls', 'model returned an unexpected function call');
  }
  if (choice.finish_reason === 'length') {
    throw new AdapterError('truncation', 'model output was truncated; no draft was accepted');
  }
  if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'refusal') {
    throw new AdapterError('refusal', 'model refused the request');
  }
  if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') {
    throw new AdapterError('tool_calls', 'model returned unexpected tool calls');
  }
  if (choice.finish_reason !== 'stop' || typeof message.content !== 'string') {
    throw new AdapterError('malformed_envelope', 'expected a completed textual assistant message');
  }
  return parseJson(message.content);
}

/** Stream both successful and error bodies with the same hard byte ceiling. */
async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > limit) {
      throw new AdapterError(
        'response_limit',
        `response declares ${declaredBytes} bytes, exceeding the ${limit} byte limit`,
      );
    }
  }
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new AdapterError('response_limit', `response exceeded the ${limit} byte limit`);
      }
      try {
        text += decoder.decode(value, { stream: true });
      } catch {
        throw new AdapterError('invalid_json', 'response is not valid UTF-8 JSON');
      }
    }
    try {
      return text + decoder.decode();
    } catch {
      throw new AdapterError('invalid_json', 'response is not valid UTF-8 JSON');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function httpError(status: number, text: string): AdapterError {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text) as unknown;
  } catch {
    return new AdapterError('http_error', `HTTP ${status} from model endpoint`);
  }
  if (
    isRecord(envelope) && isRecord(envelope.error)
    && (envelope.error.type === 'exceed_context_size_error'
      || envelope.error.code === 'context_length_exceeded')
  ) {
    return new AdapterError(
      'context_overflow', 'model context capacity was exceeded; reduce the selected reference',
    );
  }
  return new AdapterError('http_error', `HTTP ${status} from model endpoint`);
}

/**
 * Non-streaming llama-server chat completions over HTTP loopback only.
 * Redirects are refused, resource ceilings cannot be raised, and only the single
 * completed assistant content string is parsed. Draft validation belongs to the host.
 */
export class LoopbackChatAdapter implements StructuredChatAdapter {
  private readonly endpoint: string;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly seed: number | undefined;
  private readonly onResponse: LoopbackChatAdapterOptions['onResponse'];

  constructor(endpoint: string, options: LoopbackChatAdapterOptions = {}) {
    assertLoopbackUrl(endpoint);
    this.endpoint = endpoint;
    this.requestTimeoutMs = boundedLimit(
      options.requestTimeoutMs, ADAPTER_LIMITS.requestTimeoutMs,
      ADAPTER_LIMITS.requestTimeoutMs, 'requestTimeoutMs',
    );
    this.maxResponseBytes = boundedLimit(
      options.maxResponseBytes, ADAPTER_LIMITS.maxResponseBytes,
      ADAPTER_LIMITS.maxResponseBytes, 'maxResponseBytes',
    );
    this.maxTokens = boundedLimit(options.maxTokens, 2048, 4096, 'maxTokens');
    this.model = options.model ?? 'ziggurat-refine';
    if (typeof this.model !== 'string' || this.model.length < 1 || this.model.length > 128) {
      throw new AdapterError('invalid_options', 'model must contain from 1 through 128 characters');
    }
    if (
      options.seed !== undefined
      && (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffff_ffff)
    ) {
      throw new AdapterError('invalid_options', 'seed must be an unsigned 32-bit integer');
    }
    this.seed = options.seed;
    if (options.onResponse !== undefined && typeof options.onResponse !== 'function') {
      throw new AdapterError('invalid_options', 'onResponse must be a function');
    }
    this.onResponse = options.onResponse;
  }

  async completeJson(messages: readonly ChatMessage[]): Promise<unknown> {
    const requestBody = JSON.stringify({
      model: this.model,
      messages,
      stream: false,
      temperature: 0,
      max_tokens: this.maxTokens,
      ...(this.seed === undefined ? {} : { seed: this.seed }),
      response_format: {
        type: 'json_schema',
        // llama.cpp server-common.cpp reads json_schema.schema for this response type.
        json_schema: {
          name: 'ziggurat_refinement_draft',
          strict: true,
          schema: RefinementDraftJsonSchema,
        },
      },
    });
    const requestBytes = Buffer.byteLength(requestBody, 'utf8');
    if (requestBytes > ADAPTER_LIMITS.maxRequestBytes) {
      throw new AdapterError(
        'request_limit',
        `request body is ${requestBytes} bytes, exceeding the ${ADAPTER_LIMITS.maxRequestBytes} byte limit`,
      );
    }

    const signal = AbortSignal.timeout(this.requestTimeoutMs);
    let response: Response | undefined;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        redirect: 'manual',
        signal,
      });
      const redirectError = response.type === 'opaqueredirect'
        || (response.status >= 300 && response.status < 400)
        ? new AdapterError(
          'redirect', `refusing HTTP ${response.status} redirect. Redirects are not followed.`,
        )
        : undefined;
      if (redirectError !== undefined && this.onResponse === undefined) throw redirectError;
      const text = await readBoundedText(response, this.maxResponseBytes);
      try {
        this.onResponse?.({ status: response.status, body: text });
      } catch {
        throw new AdapterError('transport_error', 'response diagnostics callback failed');
      }
      if (redirectError !== undefined) throw redirectError;
      if (!response.ok) throw httpError(response.status, text);
      return unwrapCompletion(parseJson(text));
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      if (signal.aborted) {
        throw new AdapterError('timeout', `request timed out after ${this.requestTimeoutMs}ms`);
      }
      throw new AdapterError('transport_error', 'request failed while contacting the model endpoint');
    } finally {
      await response?.body?.cancel().catch(() => undefined);
    }
  }
}
