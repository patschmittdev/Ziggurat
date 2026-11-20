# Security

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository: open the **Security** tab and choose **Report a vulnerability** ([report form](https://github.com/patschmittdev/Ziggurat/security/advisories/new)). GitHub sign-in is required. If that option is not available, open a public issue asking for a private coordination channel, without exploit details. Never put vulnerability details in a public issue.

Include the affected commit, threat scenario, reproduction with fictional data, impact, and suggested mitigation. Do not submit private vault content, credentials, tokens, or reviewer private keys.

The maintainers will coordinate disclosure after the issue is understood and a fix or mitigation is available. This project is pre-release and does not promise a response-time service level.

## Supported versions

The latest commit on the default branch receives security fixes. There are no tagged releases yet.

## Scope

Defects in `examples/external-signer/` are in scope, including showing different content than it signs, mishandling keys, or defective location checks.

In scope: bypasses of receipt admission, citation or index integrity, vault path boundaries, privacy filtering, and model transport restrictions in shipped code.

Out of scope: operator-controlled filesystem or trust-policy replacement, compromise of the signing environment itself, and factual truth or human attention that the implementation does not establish. Report implementation failures that cross the documented boundary even when they start with hostile source content.

Read the [threat model](site/src/content/docs/security/threat-model.md) for assumptions, controls, and residual risks, and [guarantees](site/src/content/docs/security/guarantees.md) for enforced boundaries.
