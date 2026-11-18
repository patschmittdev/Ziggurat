export function bodyLines(body: string): string[] {
  const lines = body.split('\n');
  return body.endsWith('\n') ? lines.slice(0, -1) : lines;
}
