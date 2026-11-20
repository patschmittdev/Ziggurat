import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  sign as cryptoSign,
} from 'node:crypto';
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import {
  resolve,
  dirname,
  basename,
  relative,
  isAbsolute,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parse as parseYaml, stringify } from 'yaml';

const fields = [
  'schema_version',
  'title',
  'type',
  'sources',
  'confidence',
  'status',
  'retrieval_eligible',
  'pii',
  'sensitivity',
  'visibility',
  'egress',
  'reviewed_by',
  'reviewed_at',
  'last_verified',
  'review_after',
  'resolved_proposals',
];
function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}
function timestamp(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(
      value,
    );
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}
export function validatePage(input) {
  requireValue(
    input && typeof input === 'object' && !Array.isArray(input),
    'frontmatter must be an object',
  );
  requireValue(
    Object.keys(input).every((field) => fields.includes(field)),
    'unknown frontmatter field',
  );
  const page = { ...input };
  if (page.egress === undefined) page.egress = 'local-only';
  requireValue(page.schema_version === 1, 'schema_version must be 1');
  for (const field of ['title', 'type', 'visibility'])
    requireValue(
      typeof page[field] === 'string' && page[field].length > 0,
      `invalid ${field}`,
    );
  requireValue(
    Array.isArray(page.sources) &&
      page.sources.every((value) => typeof value === 'string'),
    'invalid sources',
  );
  for (const [field, values] of Object.entries({
    confidence: ['high', 'medium', 'low'],
    status: ['draft', 'in-review', 'reviewed'],
    pii: ['true', 'false', 'unknown'],
    sensitivity: ['public', 'internal', 'restricted'],
    egress: ['local-only', 'approved-cloud'],
  }))
    requireValue(values.includes(page[field]), `invalid ${field}`);
  requireValue(
    typeof page.retrieval_eligible === 'boolean',
    'invalid retrieval_eligible',
  );
  if (page.reviewed_by !== undefined)
    requireValue(typeof page.reviewed_by === 'string', 'invalid reviewed_by');
  for (const field of ['reviewed_at', 'last_verified', 'review_after'])
    if (page[field] !== undefined)
      requireValue(
        typeof page[field] === 'string' && timestamp(page[field]),
        `invalid ${field}`,
      );
  if (page.resolved_proposals !== undefined)
    requireValue(
      Array.isArray(page.resolved_proposals) &&
        page.resolved_proposals.every(
          (value) =>
            typeof value === 'string' &&
            /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/.test(
              value,
            ),
        ),
      'invalid resolved_proposals',
    );
  if (page.status === 'reviewed')
    requireValue(
      page.sources.length &&
        page.reviewed_by?.length &&
        page.reviewed_at &&
        page.last_verified,
      'reviewed pages require sources and review and verification metadata',
    );
  return page;
}
export function parsePage(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const close = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  requireValue(close !== -1, 'missing closed frontmatter');
  // Default YAML 1.2 options match the vault parser. Timestamps remain strings.
  let parsed;
  try {
    parsed = parseYaml(text.slice(4, close));
  } catch (error) {
    const start = error?.linePos?.[0];
    const location =
      Number.isInteger(start?.line) && Number.isInteger(start?.col)
        ? ' at line ' + start.line + ', column ' + start.col
        : '';
    throw new Error('frontmatter is not valid YAML' + location);
  }
  return { page: validatePage(parsed), body: text.slice(close + 5) };
}
function target(path) {
  requireValue(
    /^knowledge\/[a-z0-9][a-z0-9._-]*\.md$/.test(path),
    'invalid target path',
  );
  const name = path.slice(10, -3);
  requireValue(
    !name.endsWith('.') &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name.split('.')[0]),
    'invalid target filename',
  );
}
export function canonicalBytes(path, input, body) {
  target(path);
  const validated = validatePage(input);
  const page = Object.fromEntries(
    fields.map((field) => [
      field,
      validated[field] ?? (field === 'resolved_proposals' ? [] : null),
    ]),
  );
  return Buffer.from(
    JSON.stringify({
      domain: 'ziggurat-curated-page-v1',
      target_path: path,
      page,
      body: body.replace(/\r\n?/g, '\n'),
    }),
    'utf8',
  );
}
export function digest(path, page, body) {
  return createHash('sha256')
    .update(canonicalBytes(path, page, body))
    .digest('hex');
}
export function unsignedReceipt(path, page, body, keyId) {
  requireValue(
    typeof page.reviewed_by === 'string' &&
      page.reviewed_by.length &&
      page.reviewed_at,
    'reviewed_by and reviewed_at are required',
  );
  requireValue(typeof keyId === 'string' && keyId.length, 'key ID is required');
  return {
    schema_version: 1,
    decision: 'admit',
    target_path: path,
    content_sha256: digest(path, page, body),
    reviewer_id: page.reviewed_by,
    reviewed_at: page.reviewed_at,
    key_id: keyId,
    algorithm: 'ed25519',
  };
}
export function signingPayload(receipt) {
  return Buffer.from(
    JSON.stringify({
      domain: 'ziggurat-authorization-receipt-v1',
      schema_version: receipt.schema_version,
      decision: receipt.decision,
      target_path: receipt.target_path,
      content_sha256: receipt.content_sha256,
      reviewer_id: receipt.reviewer_id,
      reviewed_at: receipt.reviewed_at,
      key_id: receipt.key_id,
      algorithm: receipt.algorithm,
    }),
    'utf8',
  );
}
export function signPage(path, page, body, keyId, key) {
  requireValue(
    key.type === 'private' && key.asymmetricKeyType === 'ed25519',
    'Ed25519 private key required',
  );
  const receipt = unsignedReceipt(path, page, body, keyId);
  return {
    ...receipt,
    signature: cryptoSign(null, signingPayload(receipt), key).toString(
      'base64',
    ),
  };
}
function inert(value) {
  return value.replace(
    /[\p{Cf}\p{Default_Ignorable_Code_Point}\x00-\x08\x0a-\x1f\x7f-\x9f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu,
    (character) =>
      '\\u{' +
      character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') +
      '}',
  );
}
function visibleJson(value) {
  return JSON.stringify(value, (name, item) =>
    typeof item === 'string' ? inert(item) : item,
  ).replaceAll('\\\\u{', '\\u{');
}
function inside(root, file) {
  const rel = relative(root, file);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}
async function looksLikeVault(root) {
  try {
    return (
      (await stat(resolve(root, 'config/trust.yaml'))).isFile() &&
      (await stat(resolve(root, 'knowledge'))).isDirectory()
    );
  } catch {
    return false;
  }
}
async function refuseVaultAncestors(keyPath) {
  let directory = resolve(keyPath);
  while (true) {
    requireValue(
      !(await looksLikeVault(directory)),
      'key path or ancestor looks like a vault; key must be outside the vault',
    );
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
async function checkKeyPath(keyPath) {
  // Check addressed and resolved paths to catch accidental vault placement.
  await refuseVaultAncestors(keyPath);
  await refuseVaultAncestors(
    resolve(await realpath(dirname(resolve(keyPath))), basename(keyPath)),
  );
}
export async function runKeygen(options, io) {
  await checkKeyPath(options['private-key']);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await writeFile(
    options['private-key'],
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { flag: 'wx', mode: 0o600 },
  );
  io.stdout(
    stringify({
      trust: {
        reviewers: [
          {
            reviewer_id: options['reviewer-id'],
            key_id: options['key-id'],
            algorithm: 'ed25519',
            public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }),
          },
        ],
      },
    }),
  );
}
function displayPage(path, page, body, keyId, receipt, io) {
  // Show the canonical object, including all defaults, before confirmation.
  const canonical = JSON.parse(
    canonicalBytes(path, page, body).toString('utf8'),
  );
  for (const [name, value] of Object.entries(canonical.page)) {
    io.stderr(name + ': ' + visibleJson(value) + '\n');
  }
  io.stderr(
    'target_path: ' +
      inert(path) +
      '\nkey_id: ' +
      inert(keyId) +
      '\ncanonical_digest: ' +
      receipt.content_sha256 +
      '\n',
  );
  canonical.body
    .split('\n')
    .forEach((line, index) => io.stderr(index + 1 + ': ' + inert(line) + '\n'));
  for (const [bad, message] of [
    [page.status !== 'reviewed', 'status is not reviewed'],
    [!page.retrieval_eligible, 'retrieval_eligible is false'],
    [page.egress === 'local-only', 'egress is local-only'],
    [page.pii !== 'false', 'pii is not false'],
    [page.sensitivity === 'restricted', 'sensitivity is restricted'],
  ]) {
    if (bad) io.stderr('Warning: Gold will reject: ' + message + '\n');
  }
}
export async function runSign(options, io) {
  requireValue(options.vault, '--vault required');
  const root = await realpath(options.vault);
  requireValue(
    await looksLikeVault(root),
    'vault requires config/trust.yaml and knowledge/',
  );
  const knowledge = await realpath(resolve(root, 'knowledge'));
  // These checks prevent mistakes; they do not isolate the signing environment.
  requireValue(inside(root, knowledge), 'knowledge resolves outside the vault');
  const pageFile = await realpath(options.page);
  requireValue(
    dirname(pageFile) === knowledge,
    'page must be directly under vault knowledge/',
  );
  await refuseVaultAncestors(options['private-key']);
  const keyFile = await realpath(options['private-key']);
  requireValue(
    !inside(root, keyFile),
    'private key resolves inside the vault; keep it outside',
  );
  await refuseVaultAncestors(keyFile);
  requireValue(
    (await stat(keyFile)).nlink <= 1,
    'private key has multiple hard links',
  );
  const path = 'knowledge/' + basename(pageFile);
  // One snapshot supplies both the display and signature.
  const { page, body } = parsePage(await readFile(pageFile, 'utf8'));
  const receipt = unsignedReceipt(path, page, body, options['key-id']);
  displayPage(path, page, body, options['key-id'], receipt, io);
  const answer = await io.confirm(
    'Type ' + receipt.content_sha256.slice(0, 12) + ' to sign: ',
  );
  requireValue(
    typeof answer === 'string' && answer.length > 0,
    'confirmation ended without an answer',
  );
  requireValue(
    answer === receipt.content_sha256.slice(0, 12),
    'digest confirmation did not match',
  );
  // Read key bytes only after confirmation; output only the receipt.
  const key = createPrivateKey(await readFile(keyFile));
  const output =
    JSON.stringify(
      signPage(path, page, body, options['key-id'], key),
      null,
      2,
    ) + '\n';
  if (options.out) await writeFile(options.out, output, { flag: 'wx' });
  else io.stdout(output);
  io.stderr(
    'Receipt belongs at authorizations/' +
      basename(pageFile) +
      '.authorization.json\n',
  );
}
async function confirm(prompt) {
  requireValue(
    process.stdin.isTTY,
    'an interactive terminal is required; this is a speed bump, not proof of review',
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await Promise.race([
      rl.question(prompt),
      new Promise((resolveAnswer) =>
        rl.once('close', () => resolveAnswer(undefined)),
      ),
    ]);
  } finally {
    rl.close();
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  const allowed =
    command === 'keygen'
      ? ['private-key', 'reviewer-id', 'key-id']
      : command === 'sign'
        ? ['vault', 'page', 'private-key', 'key-id', 'out']
        : [];
  requireValue(allowed.length, 'expected keygen or sign');
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index].slice(2);
    requireValue(
      args[index].startsWith('--') &&
        allowed.includes(name) &&
        args[index + 1] &&
        !options[name],
      'invalid or duplicate option',
    );
    options[name] = args[index + 1];
  }
  for (const name of allowed.filter((name) => name !== 'out')) {
    requireValue(options[name], '--' + name + ' required');
  }
  const io = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    confirm,
  };
  if (command === 'keygen') await runKeygen(options, io);
  else await runSign(options, io);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(inert(error.message) + '\n');
    process.exitCode = 1;
  });
}
