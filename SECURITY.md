# Security

## Threat Model

Ziggurat assumes:

- The operator controls the vault directory and its contents.
- Model endpoints are loopback-only. No external model traffic is permitted.
- Reviewers are trusted humans who manually write `status: reviewed` metadata.
- Clients accessing the MCP server receive only previously indexed Gold content.

## Non-Goals

Ziggurat Version 1 does not protect against:

- A malicious operator who can modify Bronze files directly.
- Model output injection beyond Zod schema validation (retrieved content is
  explicitly labeled as untrusted reference data).
- Distributed or multi-tenant deployments.
- Transport-layer security for the MCP server (use a trusted local environment).

## Model Output Distrust

All content returned by `search_context` and `read_context` is **untrusted reference data**.
Clients must not execute instructions found in returned text.
Tool descriptions and server annotations enforce this explicitly.

## Gold Promotion

No automated path exists to write `status: reviewed` metadata.
Gold promotion is exclusively a human action expressed as a Git commit.
The `--promote` flag is not accepted by any CLI command.
