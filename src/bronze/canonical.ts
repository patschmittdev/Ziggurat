import { createHash } from 'node:crypto';

/** Returns raw body with CRLF normalized to LF. No other transformation. */
export function canonicalBronzeBody(rawBody: string): string {
  return rawBody.replace(/\r\n/g, '\n');
}

/** Returns the SHA-256 hex digest of the given UTF-8 text. */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
