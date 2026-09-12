import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { z } from 'zod';
import { runInit } from '../../src/cli/commands/init.js';
import { parseZigguratConfig } from '../../src/contracts/config.js';
import { CuratedPageSchema } from '../../src/contracts/curated.js';
import { AuthorizationReceiptUnsignedSchema } from '../../src/contracts/authorization.js';
import { authorizationReceiptPath, canonicalPageSha256 } from '../../src/authorization/canonical.js';
import { verifyPageAuthorization } from '../../src/authorization/verify.js';

const execute = promisify(execFile);
const vectorPath = fileURLToPath(new URL('../../../fixtures/authorization/receipt-vectors.json', import.meta.url));
const python = process.env['ZIGGURAT_INTEROP_PYTHON'] ?? 'python';
const vectorSchema = z.object({
  trusted_reviewer: z.object({ public_key_pem: z.string() }),
  page: z.object({
    target_path: z.string(), frontmatter: CuratedPageSchema, body: z.string(),
    canonical_page_content: z.string(), canonical_page_content_sha256: z.string(),
  }),
  signing: z.object({
    unsigned_receipt: AuthorizationReceiptUnsignedSchema,
    signing_payload: z.string(), signature: z.string(),
  }),
});

// Test-only external process: the disposable private key never leaves Python memory.
const independentSigner = String.raw`
import base64, hashlib, json, sys
import cryptography
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
with open(sys.argv[1], encoding="utf-8") as source:
    data = json.load(source)
p = data["page"]
f = p["frontmatter"]
fields = ["schema_version","title","type","sources","confidence","status","retrieval_eligible",
          "pii","sensitivity","visibility","egress","reviewed_by","reviewed_at","last_verified",
          "review_after","resolved_proposals"]
page = {key: f.get(key, [] if key == "resolved_proposals" else None) for key in fields}
body = p["body"].replace("\r\n", "\n").replace("\r", "\n")
def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
canonical = encode({"domain":"ziggurat-curated-page-v1","target_path":p["target_path"],"page":page,"body":body})
assert canonical.decode("utf-8") == p["canonical_page_content"]
digest = hashlib.sha256(canonical).hexdigest()
assert digest == p["canonical_page_content_sha256"]
r = data["signing"]["unsigned_receipt"]
receipt_fields = ["schema_version","decision","target_path","content_sha256","reviewer_id",
                  "reviewed_at","key_id","algorithm"]
payload = encode({"domain":"ziggurat-authorization-receipt-v1", **{key:r[key] for key in receipt_fields}})
assert payload.decode("utf-8") == data["signing"]["signing_payload"]
published = serialization.load_pem_public_key(data["trusted_reviewer"]["public_key_pem"].encode("ascii"))
published.verify(base64.b64decode(data["signing"]["signature"], validate=True), payload)
private = Ed25519PrivateKey.generate()
signature = private.sign(payload)
public = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
print(json.dumps({"cryptography_version":cryptography.__version__, "public_key_pem":public.decode("ascii"),
                  "signature":base64.b64encode(signature).decode("ascii"), "content_sha256":digest}))
`;

test('independent Python cryptography reproduces public vectors and signs a receipt accepted by Node', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-independent-receipt-'));
  try {
    const vector = vectorSchema.parse(JSON.parse(await readFile(vectorPath, 'utf8')));
    const result = await execute(python, ['-c', independentSigner, vectorPath], {
      timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    const output = z.object({
      cryptography_version: z.string(), public_key_pem: z.string(), signature: z.string(), content_sha256: z.string(),
    }).strict().parse(JSON.parse(result.stdout));
    t.diagnostic(`Independent cryptography version: ${output.cryptography_version}`);
    await runInit(root, { stdout() {}, stderr(message) { throw new Error(message); } });
    const config = await parseZigguratConfig(root);
    config.trust.reviewers = [{
      reviewer_id: vector.signing.unsigned_receipt.reviewer_id,
      key_id: vector.signing.unsigned_receipt.key_id,
      algorithm: 'ed25519',
      public_key_pem: output.public_key_pem,
    }];
    const receipt = { ...vector.signing.unsigned_receipt, signature: output.signature };
    await writeFile(join(root, authorizationReceiptPath(vector.page.target_path)), JSON.stringify(receipt));
    const page = vector.page.frontmatter;
    assert.equal(output.content_sha256, canonicalPageSha256(vector.page.target_path, page, vector.page.body));
    assert.equal((await verifyPageAuthorization(root, vector.page.target_path, page, vector.page.body, config)).valid, true);
    assert.equal((await verifyPageAuthorization(root, vector.page.target_path, page, vector.page.body + 'changed', config)).valid, false);
    assert.equal((await verifyPageAuthorization(root, vector.page.target_path, page, vector.page.body, {
      ...config, trust: { reviewers: [] },
    })).valid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
