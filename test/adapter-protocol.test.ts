import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { ZigguratConfigSchema } from '../src/contracts/config.js';
import { RefinementDraftJsonSchema } from '../src/contracts/refinement-draft.js';
import { ADAPTER_LIMITS, AdapterError, LoopbackChatAdapter } from '../src/refine/adapter.js';
import type { AdapterErrorCode, LoopbackChatAdapterOptions } from '../src/refine/adapter.js';

const MESSAGES = [{ role: 'user' as const, content: 'test reference' }];
const DRAFT = { schema_version: 1, title: 'only content is returned' };

function completion(content = JSON.stringify(DRAFT)): unknown {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

async function withResponse(
  body: string | Uint8Array,
  run: (adapter: LoopbackChatAdapter, requests: Record<string, unknown>[]) => Promise<void>,
  options: { status?: number; adapter?: LoopbackChatAdapterOptions } = {},
): Promise<void> {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('error', () => undefined);
    res.on('error', () => undefined);
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        contentType: req.headers['content-type'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
      });
      res.writeHead(options.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(body);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(
      new LoopbackChatAdapter(`http://127.0.0.1:${port}/v1/chat/completions`, options.adapter),
      requests,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close(err => (err != null ? reject(err) : resolve()));
    });
  }
}

function failure(code: AdapterErrorCode): (err: unknown) => boolean {
  return (err: unknown): boolean => {
    assert.ok(err instanceof AdapterError);
    assert.equal(err.name, 'AdapterError');
    assert.equal(err.code, code);
    assert.ok(!err.message.includes('sensitive-model-content'));
    return true;
  };
}

test('protocol: uses the source-verified llama.cpp schema shape and explicit generation bounds', async () => {
  await withResponse(JSON.stringify(completion()), async (adapter, requests) => {
    assert.deepEqual(await adapter.completeJson(MESSAGES), DRAFT);
    assert.deepEqual(requests, [{
      method: 'POST',
      url: '/v1/chat/completions',
      contentType: 'application/json',
      body: {
        model: 'ziggurat-refine',
        messages: MESSAGES,
        stream: false,
        temperature: 0,
        max_tokens: 2048,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ziggurat_refinement_draft',
            strict: true,
            schema: RefinementDraftJsonSchema,
          },
        },
      },
    }]);
  });
});

test('protocol: forwards an explicit model alias, token cap, and zero seed', async () => {
  await withResponse(JSON.stringify(completion()), async (adapter, requests) => {
    await adapter.completeJson(MESSAGES);
    const request = requests[0]?.body as Record<string, unknown>;
    assert.equal(request.model, 'pinned-local-model');
    assert.equal(request.max_tokens, 4096);
    assert.equal(request.seed, 0);
    assert.equal(request.temperature, 0);
    assert.equal(request.stream, false);
  }, { adapter: { model: 'pinned-local-model', maxTokens: 4096, seed: 0 } });
});

test('protocol: opt-in diagnostics observes the exact complete envelope including token usage', async () => {
  const body = ` \n${JSON.stringify(completion('{"title":"évidence 🧱"}'))}\n`;
  const observed: { status: number; body: string }[] = [];
  await withResponse(body, async (adapter, requests) => {
    assert.deepEqual(await adapter.completeJson(MESSAGES), { title: 'évidence 🧱' });
    assert.deepEqual(observed, [{ status: 200, body }]);
    const envelope = JSON.parse(observed[0]?.body ?? '') as { usage: { total_tokens: number } };
    assert.equal(envelope.usage.total_tokens, 30);
    const request = requests[0]?.body as Record<string, unknown>;
    assert.equal(Object.hasOwn(request, 'onResponse'), false);
  }, { adapter: { onResponse: response => observed.push(response) } });
});

for (const [label, status, body, code] of [
  ['non-JSON', 200, 'sensitive-model-content is not JSON\n', 'invalid_json'],
  ['malformed envelope', 200, '{"sensitive-model-content":true}', 'malformed_envelope'],
  ['refusal', 200, JSON.stringify({
    choices: [{
      message: { role: 'assistant', content: null, refusal: 'sensitive-model-content' },
      finish_reason: 'stop',
    }],
  }), 'refusal'],
  ['HTTP error', 500, '{"error":{"message":"sensitive-model-content"}}', 'http_error'],
  ['context overflow', 400, JSON.stringify({
    error: { type: 'exceed_context_size_error', message: 'sensitive-model-content' },
  }), 'context_overflow'],
  ['redirect', 302, 'sensitive-model-content redirect body', 'redirect'],
] as const) {
  test(`protocol: diagnostics receives complete ${label} body before safe rejection`, async () => {
    const observed: { status: number; body: string }[] = [];
    await withResponse(body, async adapter => {
      await assert.rejects(() => adapter.completeJson(MESSAGES), (err: unknown) => {
        assert.deepEqual(observed, [{ status, body }]);
        assert.ok(err instanceof AdapterError);
        assert.equal(Object.hasOwn(err, 'body'), false);
        assert.equal(Object.hasOwn(err, 'response'), false);
        assert.equal(Object.hasOwn(err, 'raw'), false);
        return failure(code)(err);
      });
    }, { status, adapter: { onResponse: response => observed.push(response) } });
  });
}

test('protocol: diagnostic callback failures cannot expose raw response text through errors', async () => {
  await withResponse(JSON.stringify(completion()), async adapter => {
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('transport_error'));
  }, {
    adapter: {
      onResponse: () => {
        throw new AdapterError('invalid_json', 'sensitive-model-content');
      },
    },
  });
});

test('protocol: request size counts UTF-8 bytes and accepts exactly the hard ceiling', async () => {
  await withResponse(JSON.stringify(completion()), async (adapter, requests) => {
    await adapter.completeJson([{ role: 'user', content: '' }]);
    const emptyRequestSize = Buffer.byteLength(JSON.stringify(requests[0]?.body));
    const contentBudget = ADAPTER_LIMITS.maxRequestBytes - emptyRequestSize;
    const content = 'é'.repeat(Math.floor(contentBudget / 2)) + 'a'.repeat(contentBudget % 2);
    assert.equal(Buffer.byteLength(content), contentBudget);
    assert.deepEqual(await adapter.completeJson([{ role: 'user', content }]), DRAFT);
    assert.equal(requests.length, 2);
    assert.equal(Buffer.byteLength(JSON.stringify(requests[1]?.body)), ADAPTER_LIMITS.maxRequestBytes);
    await assert.rejects(
      () => adapter.completeJson([{ role: 'user', content: `${content}a` }]),
      failure('request_limit'),
    );
    assert.equal(requests.length, 2, 'over-limit requests must not reach the server');
  });
});

const malformedEnvelopes: [string, unknown][] = [
  ['raw draft', DRAFT],
  ['null response', null],
  ['array response', [completion()]],
  ['missing choices', {}],
  ['empty choices', { choices: [] }],
  ['multiple choices', {
    choices: [
      { message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' },
      { message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' },
    ],
  }],
  ['object choices', { choices: { 0: { message: { role: 'assistant', content: '{}' } } } }],
  ['null choice', { choices: [null] }],
  ['missing message', { choices: [{ text: '{}', finish_reason: 'stop' }] }],
  ['missing role', { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }],
  ['user role', { choices: [{ message: { role: 'user', content: '{}' }, finish_reason: 'stop' }] }],
  ['missing finish_reason', { choices: [{ message: { role: 'assistant', content: '{}' } }] }],
  ['unfinished message', {
    choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: null }],
  }],
  ['unknown finish_reason', {
    choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'other' }],
  }],
  ['missing content', { choices: [{ message: { role: 'assistant' }, finish_reason: 'stop' }] }],
  ['null content', {
    choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
  }],
  ['array content', {
    choices: [{
      message: { role: 'assistant', content: [{ type: 'text', text: '{}' }] },
      finish_reason: 'stop',
    }],
  }],
  ['parsed object content', {
    choices: [{ message: { role: 'assistant', content: {} }, finish_reason: 'stop' }],
  }],
  ['streaming delta', {
    choices: [{ delta: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
  }],
  ['alternate response field', { response: '{}', content: '{}', output: DRAFT }],
  ['malformed tool_calls field', {
    choices: [{
      message: { role: 'assistant', content: '{}', tool_calls: {} },
      finish_reason: 'stop',
    }],
  }],
  ['malformed refusal field', {
    choices: [{
      message: { role: 'assistant', content: '{}', refusal: false },
      finish_reason: 'stop',
    }],
  }],
];

for (const [label, envelope] of malformedEnvelopes) {
  test(`protocol: rejects ${label}`, async () => {
    await withResponse(JSON.stringify(envelope), async adapter => {
      await assert.rejects(() => adapter.completeJson(MESSAGES), failure('malformed_envelope'));
    });
  });
}

const refusedEnvelopes: [string, unknown, AdapterErrorCode][] = [
  ['refusal with null content', {
    message: { role: 'assistant', content: null, refusal: 'sensitive-model-content' },
    finish_reason: 'stop',
  }, 'refusal'],
  ['refusal with valid JSON', {
    message: { role: 'assistant', content: '{}', refusal: 'sensitive-model-content' },
    finish_reason: 'stop',
  }, 'refusal'],
  ['content filter', {
    message: { role: 'assistant', content: '{}' },
    finish_reason: 'content_filter',
  }, 'refusal'],
  ['refusal finish reason', {
    message: { role: 'assistant', content: '{}' },
    finish_reason: 'refusal',
  }, 'refusal'],
  ['truncated valid JSON', {
    message: { role: 'assistant', content: '{}' },
    finish_reason: 'length',
  }, 'truncation'],
  ['truncated invalid JSON', {
    message: { role: 'assistant', content: '{"sensitive-model-content":' },
    finish_reason: 'length',
  }, 'truncation'],
  ['nonempty tool calls', {
    message: {
      role: 'assistant',
      content: '{}',
      tool_calls: [{ type: 'function', function: { name: 'sensitive-model-content' } }],
    },
    finish_reason: 'stop',
  }, 'tool_calls'],
  ['tool call finish reason', {
    message: { role: 'assistant', content: null },
    finish_reason: 'tool_calls',
  }, 'tool_calls'],
  ['legacy function call', {
    message: { role: 'assistant', content: '{}', function_call: { name: 'sensitive-model-content' } },
    finish_reason: 'stop',
  }, 'tool_calls'],
  ['legacy function finish reason', {
    message: { role: 'assistant', content: null },
    finish_reason: 'function_call',
  }, 'tool_calls'],
];

for (const [label, choice, code] of refusedEnvelopes) {
  test(`protocol: rejects ${label} with a distinct safe error`, async () => {
    await withResponse(JSON.stringify({ choices: [choice] }), async adapter => {
      await assert.rejects(() => adapter.completeJson(MESSAGES), failure(code));
    });
  });
}

for (const content of [
  '',
  '{"sensitive-model-content":',
  '```json\n{"sensitive-model-content":true}\n```',
  'Here is the JSON: {"sensitive-model-content":true}',
  '{"sensitive-model-content":true} trailing text',
  '{"sensitive-model-content":true,}',
  '{} {}',
]) {
  test(`protocol: never repairs invalid JSON content (${JSON.stringify(content)})`, async () => {
    await withResponse(JSON.stringify(completion(content)), async adapter => {
      await assert.rejects(() => adapter.completeJson(MESSAGES), failure('invalid_json'));
    });
  });
}

test('protocol: rejects invalid outer JSON without echoing response content', async () => {
  await withResponse('{"sensitive-model-content":', async adapter => {
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('invalid_json'));
  });
});

test('protocol: rejects invalid UTF-8 instead of replacing bytes in model content', async () => {
  const body = Buffer.concat([
    Buffer.from('{"choices":[{"message":{"role":"assistant","content":"\\"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('\\""},"finish_reason":"stop"}]}'),
  ]);
  await withResponse(body, async adapter => {
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('invalid_json'));
  });
});

test('protocol: empty refusal and tool fields are allowed; alternate payload fields are ignored', async () => {
  await withResponse(JSON.stringify({
    choices: [{
      message: {
        role: 'assistant',
        content: JSON.stringify(DRAFT),
        refusal: '',
        tool_calls: [],
        function_call: null,
        parsed: { do_not_return: true },
        reasoning_content: '{"do_not_return":true}',
      },
      finish_reason: 'stop',
    }],
    response: { do_not_return: true },
  }), async adapter => {
    assert.deepEqual(await adapter.completeJson(MESSAGES), DRAFT);
  });
});

test('protocol: content JSON shape validation remains the host responsibility', async () => {
  await withResponse(JSON.stringify(completion('null')), async adapter => {
    assert.equal(await adapter.completeJson(MESSAGES), null);
  });
});

for (const [status, error, code] of [
  [400, { type: 'exceed_context_size_error', message: 'sensitive-model-content' }, 'context_overflow'],
  [400, { code: 'context_length_exceeded', message: 'sensitive-model-content' }, 'context_overflow'],
  [500, { type: 'server_error', message: 'sensitive-model-content' }, 'http_error'],
  [400, { message: 'context size exceeded: sensitive-model-content' }, 'http_error'],
] as const) {
  test(`protocol: classifies HTTP ${status} ${JSON.stringify(error)} without response echoes`, async () => {
    await withResponse(JSON.stringify({ error }), async adapter => {
      await assert.rejects(() => adapter.completeJson(MESSAGES), failure(code));
    }, { status });
  });
}

test('protocol: non-JSON HTTP errors remain HTTP errors', async () => {
  await withResponse('sensitive-model-content', async adapter => {
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('http_error'));
  }, { status: 502 });
});

test('protocol: validates adapter model, token, and seed options without a request', () => {
  const invalidOptions: LoopbackChatAdapterOptions[] = [
    { model: '' },
    { model: 'x'.repeat(129) },
    { maxTokens: 0 },
    { maxTokens: -1 },
    { maxTokens: 4097 },
    { maxTokens: 1.5 },
    { maxTokens: Number.POSITIVE_INFINITY },
    { maxTokens: Number.NaN },
    { seed: -1 },
    { seed: 1.5 },
    { seed: Number.NaN },
    { seed: Number.POSITIVE_INFINITY },
    { seed: 0x1_0000_0000 },
  ];
  for (const options of invalidOptions) {
    assert.throws(
      () => new LoopbackChatAdapter('http://127.0.0.1:1/v1/chat/completions', options),
      failure('invalid_options'),
    );
  }
  assert.doesNotThrow(() => new LoopbackChatAdapter('http://127.0.0.1:1/v1/chat/completions', {
    model: 'x'.repeat(128), maxTokens: 1, seed: 0xffff_ffff,
  }));
});

test('protocol: endpoint errors are typed and never echo credentials or paths', () => {
  for (const endpoint of [
    'sensitive-model-content',
    'http://example.com/sensitive-model-content',
    'https://127.0.0.1/sensitive-model-content',
    'http://sensitive-model-content:secret@127.0.0.1/v1/chat/completions',
  ]) {
    assert.throws(() => new LoopbackChatAdapter(endpoint), failure('invalid_endpoint'));
  }
});

test('config: model_name is optional, bounded, and the adapters object remains strict', () => {
  const schema = ZigguratConfigSchema.shape.adapters;
  assert.deepEqual(schema.parse({}), {});
  assert.deepEqual(schema.parse({
    model_endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    model_name: 'pinned-local-model',
  }), {
    model_endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    model_name: 'pinned-local-model',
  });
  assert.equal(schema.safeParse({ model_name: 'x'.repeat(128) }).success, true);
  for (const value of [
    { model_name: '' },
    { model_name: 'x'.repeat(129) },
    { model_name: 12 },
    { requestTimeoutMs: 60_000 },
    { timeout_ms: 60_000 },
    { onResponse: () => undefined },
  ]) {
    assert.equal(schema.safeParse(value).success, false);
  }
});
