export function inertText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(
      /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}

export function inertSingleLineText(value: string): string {
  return inertText(value).replace(/\n/gu, '\\n');
}

export function safeJsonStringify(value: unknown, space?: number): string {
  return inertText(JSON.stringify(value, null, space));
}
