# Standalone external signer

Copy this directory to a separate signing environment outside the vault. Use
Node 22 or newer and `npm ci --ignore-scripts` there (requires registry access). The only dependency
is the exact `yaml` version in package.json. There are no package scripts.

See the repository guide at
`site/src/content/docs/guides/external-signing.md` for the full workflow.
Run `node signer.mjs keygen --private-key ~/ziggurat-reviewer/reviewer-a.pem --reviewer-id reviewer-a --key-id reviewer-a-2026`.
Run `node signer.mjs sign --vault /vault --page /vault/knowledge/garden.md --private-key ~/ziggurat-reviewer/reviewer-a.pem --key-id reviewer-a-2026 --out receipt.json`.

The key must resolve outside the vault. Location checks guard against mistakes and are not a security boundary. Key generation uses exclusive creation
and mode 0600 where supported. On Windows mode bits are not applied; restrict the key file ACL to the key holder. Configure OS permissions separately. Never expose
the key or signing environment holding it to a model, agent, MCP server, or vault automation. The digest
prompt requires interactive stdin; it does not prove human attention. Review data
and diagnostics go to stderr. Receipt JSON goes to stdout or the requested new
output file. Transfer only that receipt to the vault's indicated authorization path.

Exports are `parsePage`, `validatePage`, `canonicalBytes`, `digest`,
`unsignedReceipt`, `signingPayload`, and `signPage`. `signPage` takes an Ed25519
private KeyObject as its last argument. These exports never prompt or write files.
The example does not import the Ziggurat runtime. Build and read verification
remain the authority on admission, including every other Gold eligibility rule.

The async runSign(options, io) and runKeygen(options, io) exports take stdout and
stderr callbacks and an async confirm(prompt) callback. The CLI supplies the TTY
prompt; signPage remains pure. The display shows every signed field and defaults,
then target path, key ID, full digest and numbered body.
