---
title: Sign a page and reach Gold
description: Use the standalone reference signer to authorize one synthetic page.
---

A trusted key's signature controls admission. A receipt proves exact canonical
content authorization, not human identity, attention, truth or semantic support.
The Ziggurat runtime (CLI, MCP server and src/) has no signing, approval, apply or
promotion command. The repository also contains a standalone reference signer in
examples/external-signer/, meant to run outside the vault under the key holder's
control. Tests sign only with disposable keys they generate.

Use bash on Linux, macOS, WSL or Git Bash, with Node 22 or newer.
This walkthrough runs both terminals on one machine as one user to demonstrate
the flow. It does not provide the separation a deployment needs. Use OS permissions
and a separate signing environment for deployment. Location checks guard against
mistakes and are not a security boundary. Keep the private key and any environment
holding it beyond the reach of models, agents, MCP servers and vault automation.
The TTY prompt is a speed bump, not proof of review.

## Vault terminal: build and ingest

Working directory: your checkout. Set CHECKOUT and VAULT to absolute paths.

~~~bash
cd /absolute/path/to/checkout
CHECKOUT="$PWD"
VAULT="$CHECKOUT/my-vault"
npm ci
npm run build
node "$CHECKOUT/dist/src/cli/main.js" init --root "$VAULT"
printf '%s\n' 'The synthetic garden has a blue gate.' > "$VAULT/inbox/note.md"
node "$CHECKOUT/dist/src/cli/main.js" ingest --root "$VAULT" --file inbox/note.md
SOURCE_PATH=$(cd "$VAULT" && find bronze -type f -name '*.md' | head -n 1)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$VAULT/knowledge/garden.md" <<EOF
---
schema_version: 1
title: Synthetic garden
type: concept
sources:
  - $SOURCE_PATH
confidence: high
status: reviewed
retrieval_eligible: true
pii: 'false'
sensitivity: public
visibility: public
egress: approved-cloud
reviewed_by: reviewer-a
reviewed_at: $NOW
last_verified: $NOW
---
The synthetic garden has a blue gate.
EOF
~~~

Use a fresh demo vault so find selects the single ingested Bronze record.
Fresh Bronze remains restricted and PII-unknown. Gold checks lineage integrity
and the page's own eligibility metadata.

## Signing terminal: prepare and generate a key

Working directory: ~/ziggurat-reviewer, outside the repository and vault.
Set CHECKOUT to the same absolute checkout path used in the vault terminal.
Copy files into the created directory so re-running does not nest directories.
Dependency installation needs registry access and uses the included lockfile.

~~~bash
CHECKOUT=/absolute/path/to/checkout
mkdir -p ~/ziggurat-reviewer
cp "$CHECKOUT/examples/external-signer/"* ~/ziggurat-reviewer/
cd ~/ziggurat-reviewer
npm ci --ignore-scripts
node "$PWD/signer.mjs" keygen --private-key "$HOME/ziggurat-reviewer/reviewer-a.pem" --reviewer-id reviewer-a --key-id reviewer-a-2026
~~~

Keygen refuses an existing key; retain the existing key when re-running.
On POSIX the key mode is 0600. On Windows mode bits are not applied, so restrict
the key file's ACL to the key holder. Keygen prints only a public trust entry.

## Vault terminal: configure trust

Working directory: the checkout. Inspect the public key and identifiers printed
by keygen. Replace the empty trust.reviewers list in my-vault/config/trust.yaml
with that entry. For an existing vault merge deliberately. Anyone able to replace
trust configuration and rebuild can establish a new trust root.

## Signing terminal: review and sign

Working directory: ~/ziggurat-reviewer. Use absolute paths for every handoff.
Remove an old receipt first when re-running; output refuses existing files.

~~~bash
VAULT=/absolute/path/to/checkout/my-vault
rm -f "$HOME/ziggurat-reviewer/garden-receipt.json"
node "$PWD/signer.mjs" sign --vault "$VAULT" --page "$VAULT/knowledge/garden.md" --private-key "$HOME/ziggurat-reviewer/reviewer-a.pem" --key-id reviewer-a-2026 --out "$HOME/ziggurat-reviewer/garden-receipt.json"
~~~

Check every displayed frontmatter field, especially sources, pii, sensitivity,
egress and resolved_proposals. The display includes null and empty-array defaults,
target path, key ID, full digest and numbered body. Controls appear as visible
Unicode tokens. Check the evidence and metadata before typing the requested digest
prefix. A signature alone does not prove this review occurred.

## Vault terminal: transfer, build and query

Working directory: the checkout. Transfer only the receipt.

~~~bash
cp "$HOME/ziggurat-reviewer/garden-receipt.json" "$VAULT/authorizations/garden.md.authorization.json"
node "$CHECKOUT/dist/src/cli/main.js" build --root "$VAULT"
node "$CHECKOUT/dist/src/cli/main.js" query --root "$VAULT" --query garden
~~~

The query returns the synthetic garden with instruction_authority=none.
Warnings cover several obvious failures; build checks every Gold eligibility rule.

## Vault terminal: check failures

~~~bash
cp "$VAULT/knowledge/garden.md" "$HOME/ziggurat-reviewer/garden-original.md"
printf 'x\n' >> "$VAULT/knowledge/garden.md"
node "$CHECKOUT/dist/src/cli/main.js" build --root "$VAULT" --json
cp "$HOME/ziggurat-reviewer/garden-original.md" "$VAULT/knowledge/garden.md"
~~~

The altered page is excluded with authorization.content-mismatch. Remove the
reviewer-a entry from config/trust.yaml, leaving trust: { reviewers: [] }, then
build and query again. The restored page is excluded with
authorization.key-untrusted. Revocation takes effect at verification or rebuild.

See the [authorization protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md),
[interop procedure](https://github.com/patschmittdev/Ziggurat/blob/main/docs/external-signing-interop.md)
and [threat model](../security/threat-model.md) for exact bytes and assumptions.
