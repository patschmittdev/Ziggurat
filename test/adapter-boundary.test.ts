import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { ADAPTER_LIMITS, LoopbackChatAdapter } from '../src/refine/adapter.js';

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
      /refusing HTTP 30\d redirect .*198\.51\.100\.7.*Redirects are not followed/su,
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
      /Redirects are not followed/u,
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
      /declares \d+ bytes, exceeding the \d+ byte limit/u,
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
      if (res.writableEnded) return;
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
      /response exceeded the 8192 byte limit/u,
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
      /failed or timed out after 150ms/u,
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
      /is not valid JSON/u,
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
    await assert.rejects(() => adapter.completeJson(MESSAGES), /HTTP 500 from/u);
  } finally {
    await server.close();
  }
});

test('adapter: accepts a well-formed bounded JSON response', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"choices":[{"message":{"content":"{}"}}]}');
  });
  try {
    const adapter = new LoopbackChatAdapter(endpoint(server.port));
    const result = await adapter.completeJson(MESSAGES);
    assert.deepEqual(result, { choices: [{ message: { content: '{}' } }] });
  } finally {
    await server.close();
  }
});

test('adapter: rejects non-positive resource limits at construction', () => {
  assert.throws(
    () => new LoopbackChatAdapter('http://127.0.0.1:1/x', { requestTimeoutMs: 0 }),
    /requestTimeoutMs must be a positive integer/u,
  );
  assert.throws(
    () => new LoopbackChatAdapter('http://127.0.0.1:1/x', { maxResponseBytes: -1 }),
    /maxResponseBytes must be a positive integer/u,
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
      /request body is \d+ bytes, exceeding the \d+ byte limit/u,
    );
    assert.equal(server.requestCount(), 0, 'an oversize request must never be sent');
  } finally {
    await server.close();
  }
});
