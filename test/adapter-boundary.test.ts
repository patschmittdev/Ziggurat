import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { ADAPTER_LIMITS, AdapterError, LoopbackChatAdapter } from '../src/refine/adapter.js';
import type { AdapterErrorCode } from '../src/refine/adapter.js';

type Handler = Parameters<typeof createServer>[1];

interface RunningServer {
  port: number;
  requestCount: () => number;
  close: () => Promise<void>;
}

async function startServer(handler: Handler): Promise<RunningServer> {
  let requests = 0;
  const server: Server = createServer((req, res) => {
    requests += 1;
    // Drain the request body so keep-alive sockets do not stall, and swallow socket
    // errors caused by the client aborting a refused response mid-stream.
    req.resume();
    req.on('error', () => undefined);
    res.on('error', () => undefined);
    (handler as (rq: typeof req, rs: typeof res) => void)(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close(err => (err != null ? reject(err) : resolve()));
      }),
  };
}

function endpoint(port: number): string {
  return `http://127.0.0.1:${port}/v1/chat/completions`;
}

const MESSAGES = [{ role: 'user' as const, content: 'test' }];

function failure(code: AdapterErrorCode): (err: unknown) => boolean {
  return (err: unknown): boolean => {
    assert.ok(err instanceof AdapterError);
    assert.equal(err.code, code);
    return true;
  };
}

test('adapter: refuses a loopback redirect to a non-loopback destination', async () => {
  const redirector = await startServer((_req, res) => {
    // 198.51.100.0/24 is TEST-NET-2: a stand-in for an off-machine exfiltration target.
    res.writeHead(302, { Location: 'http://198.51.100.7:9/v1/chat/completions' });
    res.end();
  });

  try {
    const adapter = new LoopbackChatAdapter(endpoint(redirector.port), {
      requestTimeoutMs: 2_000,
    });
    await assert.rejects(
      () => adapter.completeJson(MESSAGES),
      failure('redirect'),
    );
    assert.equal(redirector.requestCount(), 1);
  } finally {
    await redirector.close();
  }
});

test('adapter: a redirect destination is never contacted', async () => {
  // The destination is another loopback server purely so the test can count requests
  // and prove the adapter stopped at the redirect.
  const target = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"exfiltrated":true}');
  });
  const redirector = await startServer((_req, res) => {
    res.writeHead(307, { Location: endpoint(target.port) });
    res.end();
  });

  try {
    const adapter = new LoopbackChatAdapter(endpoint(redirector.port));
    await assert.rejects(
      () => adapter.completeJson(MESSAGES),
      failure('redirect'),
    );
    assert.equal(target.requestCount(), 0);
  } finally {
    await redirector.close();
    await target.close();
  }
});

test('adapter: refuses a response whose declared content-length exceeds the limit', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': String(ADAPTER_LIMITS.maxResponseBytes + 1),
    });
    res.end();
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port));
    await assert.rejects(
      () => adapter.completeJson(MESSAGES),
      failure('response_limit'),
    );
  } finally {
    await server.close();
  }
});

test('adapter: refuses an oversize streamed response without buffering it all', async () => {
  const chunk = 'x'.repeat(4096);
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Chunked, so no content-length is declared: the ceiling must hold while streaming.
    const pump = (): void => {
      if (res.writableEnded || res.destroyed) return;
      if (res.write(chunk)) setImmediate(pump);
      else res.once('drain', pump);
    };
    pump();
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), {
      maxResponseBytes: 8192,
    });
    await assert.rejects(
      () => adapter.completeJson(MESSAGES),
      failure('response_limit'),
    );
  } finally {
    await server.close();
  }
});

test('adapter: times out a server that never responds', async () => {
  const server = await startServer(() => {
    // Intentionally never writes a response.
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), {
      requestTimeoutMs: 150,
    });
    await assert.rejects(
      () => adapter.completeJson(MESSAGES),
      failure('timeout'),
    );
  } finally {
    await server.close();
  }
});

test('adapter: refuses a non-JSON response body', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>not json</html>');
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port));
    await assert.rejects(
      () => adapter.completeJson(MESSAGES),
      failure('invalid_json'),
    );
  } finally {
    await server.close();
  }
});

test('adapter: refuses a non-2xx response', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"boom"}');
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port));
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('http_error'));
  } finally {
    await server.close();
  }
});

test('adapter: accepts a well-formed bounded JSON response', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"choices":[{"message":{"role":"assistant","content":"{}"},"finish_reason":"stop"}]}');
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port));
    const result = await adapter.completeJson(MESSAGES);
    assert.deepEqual(result, {});
  } finally {
    await server.close();
  }
});

test('adapter: rejects non-positive resource limits at construction', () => {
  assert.throws(
    () => new LoopbackChatAdapter('http://127.0.0.1:1/x', { requestTimeoutMs: 0 }),
    failure('invalid_options'),
  );
  assert.throws(
    () => new LoopbackChatAdapter('http://127.0.0.1:1/x', { maxResponseBytes: -1 }),
    failure('invalid_options'),
  );
});

test('adapter: documented limits stay conservative', () => {
  assert.equal(ADAPTER_LIMITS.requestTimeoutMs, 30_000);
  assert.equal(ADAPTER_LIMITS.maxResponseBytes, 1_048_576);
  assert.equal(ADAPTER_LIMITS.maxRequestBytes, 1_048_576);
});

test('adapter: refuses a request body larger than the request ceiling', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port));
    const huge = 'y'.repeat(ADAPTER_LIMITS.maxRequestBytes + 1);
    await assert.rejects(
      () => adapter.completeJson([{ role: 'user', content: huge }]),
      failure('request_limit'),
    );
    assert.equal(server.requestCount(), 0, 'an oversize request must never be sent');
  } finally {
    await server.close();
  }
});

test('adapter: times out while streaming a response body', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices":[');
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), { requestTimeoutMs: 150 });
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('timeout'));
  } finally {
    await server.close();
  }
});

test('adapter: times out while streaming an HTTP error body', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.write('{"error":');
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), { requestTimeoutMs: 150 });
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('timeout'));
  } finally {
    await server.close();
  }
});

test('adapter: resource overrides cannot raise hard production ceilings', () => {
  for (const options of [
    { requestTimeoutMs: ADAPTER_LIMITS.requestTimeoutMs + 1 },
    { maxResponseBytes: ADAPTER_LIMITS.maxResponseBytes + 1 },
    { requestTimeoutMs: Number.POSITIVE_INFINITY },
    { maxResponseBytes: Number.NaN },
    { requestTimeoutMs: 1.5 },
    { maxResponseBytes: 1.5 },
  ]) {
    assert.throws(
      () => new LoopbackChatAdapter('http://127.0.0.1:1/x', options),
      failure('invalid_options'),
    );
  }
});

test('adapter: HTTP error bodies are bounded too', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('x'.repeat(4096));
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), { maxResponseBytes: 1024 });
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('response_limit'));
  } finally {
    await server.close();
  }
});

test('adapter: a response at the byte ceiling is accepted, one byte above is refused', async () => {
  const body = JSON.stringify({
    choices: [{
      message: { role: 'assistant', content: '{"title":"évidence 🧱"}' },
      finish_reason: 'stop',
    }],
  });
  const size = Buffer.byteLength(body);
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': size });
    res.end(body);
  });
  try {
    const accepted = new LoopbackChatAdapter(endpoint(server.port), { maxResponseBytes: size });
    assert.deepEqual(await accepted.completeJson(MESSAGES), { title: 'évidence 🧱' });
    const refused = new LoopbackChatAdapter(endpoint(server.port), { maxResponseBytes: size - 1 });
    await assert.rejects(() => refused.completeJson(MESSAGES), failure('response_limit'));
  } finally {
    await server.close();
  }
});

test('adapter: redirect errors do not echo untrusted Location headers', async () => {
  const secret = 'private-reference-fragment';
  const server = await startServer((_req, res) => {
    res.writeHead(302, { Location: `http://example.com/${secret}` });
    res.end();
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port));
    await assert.rejects(() => adapter.completeJson(MESSAGES), (err: unknown) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.code, 'redirect');
      assert.ok(!err.message.includes(secret));
      assert.ok(!err.message.includes('example.com'));
      return true;
    });
  } finally {
    await server.close();
  }
});

test('adapter: premature connection failure has a safe transport error', async () => {
  const server = await startServer((req, _res) => {
    req.socket.destroy();
  });
  try {
    const adapter = new LoopbackChatAdapter(`${endpoint(server.port)}?private-reference-fragment`);
    await assert.rejects(() => adapter.completeJson(MESSAGES), (err: unknown) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.code, 'transport_error');
      assert.ok(!err.message.includes('private-reference-fragment'));
      return true;
    });
  } finally {
    await server.close();
  }
});

test('adapter: diagnostics never captures a response exceeding its declared byte ceiling', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': ADAPTER_LIMITS.maxResponseBytes + 1,
    });
    res.end();
  });
  const observed: unknown[] = [];
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), {
      onResponse: response => observed.push(response),
    });
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('response_limit'));
    assert.deepEqual(observed, []);
  } finally {
    await server.close();
  }
});

test('adapter: diagnostics never captures a response exceeding the streaming byte ceiling', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
    res.write('x'.repeat(1024));
    res.end('x');
  });
  const observed: unknown[] = [];
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), {
      maxResponseBytes: 1024,
      onResponse: response => observed.push(response),
    });
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('response_limit'));
    assert.deepEqual(observed, []);
  } finally {
    await server.close();
  }
});

test('adapter: diagnostics never captures partial response bodies on timeout', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices":[');
  });
  const observed: unknown[] = [];
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port), {
      requestTimeoutMs: 150,
      onResponse: response => observed.push(response),
    });
    await assert.rejects(() => adapter.completeJson(MESSAGES), failure('timeout'));
    assert.deepEqual(observed, []);
  } finally {
    await server.close();
  }
});
