# External signing interoperability

Ziggurat verifies receipts. It does not provide a signing command, obtain a private
key, establish human attention, or turn a review checklist into authorization.
The separately controlled signing environment must belong to the reviewer and
must not be exposed through model tools, MCP, or the vault's automation.

## Verified independent reference

The test-only interoperability harness uses Python's `cryptography` Ed25519
implementation in a separate process. On the reference Windows machine,
`cryptography` 50.0.0 reproduced the published canonical page bytes and digest,
reproduced the exact receipt signing payload, and verified the published fixture
signature. A new disposable key was then generated entirely in the Python process;
its signature was accepted by Ziggurat's Node verifier and refused for a changed
page or an untrusted key. No private key left that process.

Run this optional test in an independently prepared Python environment:

```powershell
python -c "import cryptography; print(cryptography.__version__)"
npm run test:interop
```

`ZIGGURAT_INTEROP_PYTHON` can select a separate Python executable. Missing Python
or the package fails this explicit test rather than becoming a passing skip.
The default core test command does not install or invoke an external signer.
The harness uses only published vectors and disposable test keys; it is not a
command for authorizing real pages.

The installed Git-bundled OpenSSL 1.1.1u did not support `pkeyutl -rawin`, so it
was not reported as a working receipt signer. Do not substitute OpenSSH signatures,
prehashed signatures, or a different signing envelope for the direct Ed25519
payload defined by receipt v1.

## Human-controlled handoff

1. Review the full candidate, exact evidence, contradictions, proposed diff, and
   current base state. Independently judge whether the claim should persist.
2. Author the final knowledge page outside the model pathway. Confirm its privacy,
   retrieval, reviewer, verification, and contradiction-resolution metadata.
3. In the separately controlled signing environment, independently parse the
   final page and reproduce the canonical bytes in
   [the authorization protocol](authorization-protocol.md). Preserve specified
   property and array order, normalize only the prescribed line endings, use UTF-8,
   and append no newline to the compact JSON.
4. Display the final page, target path, canonical digest, reviewer ID, timestamp,
   and key ID to the human. Require explicit confirmation in the external tool.
   A valid signature alone cannot prove this happened.
5. Use the externally held Ed25519 private key to sign the exact domain-separated
   payload bytes, not the digest of that payload. Python `cryptography` exposes
   this primitive as `Ed25519PrivateKey.sign(payload_bytes)`. Its
   `Ed25519PublicKey.verify(signature, payload_bytes)` verifies the result.
6. Transfer only the strict detached JSON receipt to its deterministic
   `authorizations/<page>.authorization.json` location. Configure only the public
   key in `config/trust.yaml`, through deliberate operator action.
7. Rebuild and inspect eligibility reasons. Changing the page after signing, using
   a removed key, or leaving another admission rule unsatisfied must not admit it.

This is an interoperability procedure, not a shipped signer or a key-custody
service. Choose or maintain the external approval interface under the reviewer's
control, and test it against the public vectors before using a real key.

## Capability checks

The signing environment must reject unknown fields and unsupported algorithms,
bind the exact target and review identity/time, refuse stale input, and keep the
private key inaccessible to Ziggurat and model processes. Do not infer factual
truth, completed review, or instruction authority from an otherwise valid receipt.
