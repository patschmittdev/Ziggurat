---
title: Authorization protocol
description: Where the byte-level signing contract lives, and what an external signer must check.
---

:::caution[The specification is canonical, this page is not]
The byte-exact contract lives in
[docs/authorization-protocol.md](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md).
Implement a signer against that document, not against this page. Nothing here
redefines a byte.
:::

The signing payload is domain separated so a signature over one kind of object cannot
be replayed as another. Changes to signed bytes require a new protocol version rather
than an in-place reinterpretation.

`fixtures/authorization/receipt-vectors.json` publishes interoperability vectors. An
independent signer should reproduce them before being trusted with a real key. The
TypeScript implementation remains the authoritative verifier.
