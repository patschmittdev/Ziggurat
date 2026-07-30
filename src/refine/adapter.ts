const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StructuredChatAdapter {
  completeJson(messages: readonly ChatMessage[]): Promise<unknown>;
}

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
      body: JSON.stringify({ messages }),
    });
    if (!response.ok) {
      throw new Error(
        `LoopbackChatAdapter: HTTP ${response.status} from ${this.endpoint}`,
      );
    }
    return response.json() as Promise<unknown>;
  }
}
