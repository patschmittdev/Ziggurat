---
title: Project status
description: Pre-release status and bounded evidence.
---

Ziggurat 0.1.0 is pre-release, source-only, with no tagged releases. Ziggurat is not published to npm; install it from source. Contracts, indexes, and CLI behavior may change before 1.0.

**Experimental:** model refinement has no human usability scores. Initial staging was 79/90, below the 81/90 gate. A revision staged 90/90 on the same fixtures that informed it, so it is not a held-out result; human acceptance remains pending. See [model evidence](https://github.com/patschmittdev/Ziggurat/blob/main/docs/model-workflow-evaluation.md).

Retrieval has no abstention: on the small synthetic corpus, 4/6 no-answer queries still returned results. A threshold experiment selected no candidate. Exact-identifier holdout top-1 reached 8/8 on that corpus. On the separate abstention fixture, the Gold-ID baseline holdout reached 3/6 exact top-1; see [retrieval evidence](https://github.com/patschmittdev/Ziggurat/blob/main/docs/retrieval-evaluation.md).

On synthetic files, the documented 1,000-page workload met its targets on one Windows machine with a 512 MiB old-space setting. Default-heap RSS failed. Linux tmpfs ENOSPC recovery passed; native Windows disk-full recovery remains unverified. See the [operating envelope](https://github.com/patschmittdev/Ziggurat/blob/main/docs/operating-envelope.md).

[External signing interoperability](https://github.com/patschmittdev/Ziggurat/blob/main/docs/external-signing-interop.md) used independent Python signing bytes and disposable signatures accepted by Node; it proves neither human review nor a shipped signer.

These measurements do not establish adoption, deployments, third-party audits, human acceptance, production maturity, or performance on arbitrary user corpora.
