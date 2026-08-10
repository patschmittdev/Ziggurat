# Contributing

## Development Workflow

1. Write failing tests first (TDD).
2. Implement the minimum code to pass the tests.
3. Run `npm run check` and confirm zero failures before committing.
4. Run `node dist/src/cli/main.js check --root . --audit-clean-room --json` to verify no clean-room violations.

## Clean-Room Requirements

The repository must not contain:

- Absolute file paths from any contributor's machine.
- Email addresses, tokens, or credentials.
- Git remote URLs pointing to personal repositories.
- Personal project names from the owner's portfolio.
- Index artifact files (`.ziggurat/*.json`).

Run `ziggurat check --audit-clean-room` to verify.

## Gold Promotion

Human-only. Never write `status: reviewed` metadata programmatically.
The `--promote` flag is not accepted by any command and must not be added.
Gold promotion is a human Git commit of reviewed frontmatter.

## Testing

- Use real temporary files. Do not mock the filesystem.
- All tests must pass on Windows, macOS, and Linux.
- Property tests use `fast-check` with deterministic seeds where meaningful.
- Do not add tests that require network access.

## TypeScript

- Strict mode. No `any`. No CommonJS compatibility code.
- NodeNext ESM module resolution throughout.
- All untrusted inputs pass runtime Zod validation.
