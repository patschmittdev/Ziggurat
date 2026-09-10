import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = await realpath(resolve(import.meta.dirname, '../dist'));
const base = '/Ziggurat';
const port = Number(process.env.PORT ?? 4329);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

function insideRoot(file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  if ((pathname !== base && !pathname.startsWith(`${base}/`)) ||
      pathname.includes('\\') || pathname.includes('\0')) {
    response.writeHead(404).end();
    return;
  }

  let file = resolve(root, `.${pathname.slice(base.length)}`);
  if (pathname.endsWith('/') || !extname(pathname)) file = join(file, 'index.html');
  if (!insideRoot(file)) {
    response.writeHead(404).end();
    return;
  }

  try {
    file = await realpath(file);
    if (!insideRoot(file)) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) {
      response.writeHead(404).end();
    } else {
      console.error(error);
      response.writeHead(500).end();
    }
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static preview listening at http://127.0.0.1:${server.address().port}${base}/`);
});
