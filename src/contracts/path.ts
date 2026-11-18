const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;

export function isNormalizedRelativePath(value: string): boolean {
  if (value === '' || value.includes('\\') || value.startsWith('/')) return false;
  if (/^[a-zA-Z]:/u.test(value)) return false;
  if (/[\x00-\x1f\x7f-\x9f]/u.test(value)) return false;
  return value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function isKnowledgePath(value: string): boolean {
  if (!/^knowledge\/[a-z0-9][a-z0-9._-]*\.md$/u.test(value)) return false;
  const filename = value.slice('knowledge/'.length, -'.md'.length);
  if (filename.endsWith('.')) return false;
  const deviceStem = filename.split('.')[0] ?? '';
  return !WINDOWS_RESERVED.test(deviceStem);
}
