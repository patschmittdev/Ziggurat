import type { TokenUsage } from './model-report.js';

export interface ResponseSnapshot {
  status: number;
  body: string;
}

export function observeResponse(response: ResponseSnapshot | null, unavailableReason: string) {
  let usage: TokenUsage | null = null;
  let usageReason: string | null = 'No complete bounded response was captured; token usage is unavailable.';
  if (response !== null) {
    usageReason = 'The captured response has no usable server token counts; no estimates were substituted.';
    try {
      const envelope: unknown = JSON.parse(response.body);
      if (typeof envelope === 'object' && envelope !== null && 'usage' in envelope
        && typeof envelope.usage === 'object' && envelope.usage !== null && !Array.isArray(envelope.usage)) {
        const values = envelope.usage as Record<string, unknown>;
        const count = (name: string): number | null =>
          typeof values[name] === 'number' && Number.isSafeInteger(values[name]) && values[name] >= 0
            ? values[name] : null;
        const parsed = {
          prompt_tokens: count('prompt_tokens'),
          completion_tokens: count('completion_tokens'),
          total_tokens: count('total_tokens'),
        };
        if (Object.values(parsed).some(value => value !== null)) {
          usage = parsed;
          usageReason = Object.values(parsed).every(value => value !== null)
            ? null : 'Some server token counts are missing or invalid; only valid counts are retained.';
        }
      }
    } catch {
      usageReason = 'The captured response is not valid envelope JSON; raw text is preserved without repair.';
    }
  }
  return {
    received: response !== null,
    status: response?.status ?? null,
    body: response?.body ?? null,
    unavailable_reason: response === null ? unavailableReason : null,
    token_usage: usage,
    token_usage_reason: usageReason,
    content_role: 'untrusted-reference',
    instruction_authority: 'none',
  };
}
