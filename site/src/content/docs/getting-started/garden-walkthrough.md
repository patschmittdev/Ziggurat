---
title: The garden walkthrough
description: Run the poisoned-memory scenario against fixture data and watch it stop at the human signing boundary.
---

The repository ships a fixture vault and a script that runs the whole scenario.

```bash
node scripts/run-garden-walkthrough.mjs
```

The script stops at the human signing boundary by design. There is no automated step past
it, because there is no code path past it.

## What the fixture contains

`fixtures/garden/inbox/poisoned-memory-rule.md` is a plausible-looking memo that
instructs an AI to skip review and to remember a vendor as approved. It is exactly the
kind of document that succeeds against a system where writing memory is an ordinary model
action.

That material is described here, never reproduced. Nothing on this site quotes the
hostile instruction text, and nothing retrieved through Ziggurat carries instruction
authority in any case.

## What the automated test demonstrates

`test/memory-boundary.test.ts` asserts the complete defence:

1. Ingestion preserves the hostile text as restricted, PII-unknown Bronze evidence.
2. The model pathway stages an evidence-backed Silver candidate and writes no knowledge,
   authorization, Bronze, or index file.
3. `review` displays the embedded instruction under an `UNTRUSTED REFERENCE` warning.
4. The poisoned Bronze record is excluded from model-readable evidence and review indexes
   while its privacy state is unresolved.
5. A knowledge page carrying self-asserted reviewed metadata does not change communion.
6. Communion changes only after the test simulates an external reviewer key and writes a
   matching receipt.
7. Retrieved Gold still reports no instruction authority.
8. Tampering with the stored index causes retrieval to fail closed.

Step 6 is the one that matters most. The test has to *simulate a human holding a key* to
get past the boundary, because no shipped code path can.

## Run it yourself

```bash
npm ci
npm run build
npm run check
node scripts/run-garden-walkthrough.mjs
```
`npm run check` runs the full compiled suite, which includes the memory-boundary test
above.

## Next

- [The human authority boundary](/Ziggurat/concepts/human-authority-boundary/) explains what the
  script stops at.
- [Attack-control mapping](/Ziggurat/security/attack-controls/) maps this scenario to the
  memory-poisoning controls it implements.
