## Summary

Describe the problem, the change, and any compatibility impact.

## Trust-boundary impact

Explain whether this changes Bronze capture, Silver proposals, human authorization,
Gold admission, profile isolation, retrieval integrity, or instruction-authority
labels. Write "None" when it does not.

## Validation

List the targeted checks you ran.

## Checklist

- [ ] Behavior changes include tests that use real temporary files.
- [ ] Model pathways still cannot write Bronze, knowledge, trust, receipts, reviewed metadata, or indexes.
- [ ] No signer, apply, approve, promote command, or `--promote` flag was added.
- [ ] Retrieved content remains reference-only with `instruction_authority: none`.
- [ ] Documentation and compatibility notes match the implementation.
- [ ] `npm run check` passes.
- [ ] `node dist/src/cli/main.js check --root . --audit-clean-room` passes.
- [ ] No private key, credential, personal path, or private vault content is included.
