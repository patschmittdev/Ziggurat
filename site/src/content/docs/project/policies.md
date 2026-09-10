---
title: Repository policies
description: The canonical repository documents, what each one governs, and where to find it.
---

Ziggurat keeps its normative documents in the repository rather than on this site, so
that a reader of the source always has the authoritative text alongside the code it
describes.

| Document | Governs |
|---|---|
| [ARCHITECTURE.md](https://github.com/patschmittdev/Ziggurat/blob/main/ARCHITECTURE.md) | Assets, actors, capabilities, trust boundaries, state transitions, and enforcement points |
| [SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md) | Threat model, attack mapping, fail-closed behaviour, residual risks, and vulnerability reporting |
| [docs/authorization-protocol.md](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md) | The byte-level canonicalization and signing contract |
| [CONTRIBUTING.md](https://github.com/patschmittdev/Ziggurat/blob/main/CONTRIBUTING.md) | Development workflow and the boundary rules a change must not break |
| [SUPPORT.md](https://github.com/patschmittdev/Ziggurat/blob/main/SUPPORT.md) | Where to ask questions |
| [CODE_OF_CONDUCT.md](https://github.com/patschmittdev/Ziggurat/blob/main/CODE_OF_CONDUCT.md) | Expected conduct in project spaces |
| [LICENSE](https://github.com/patschmittdev/Ziggurat/blob/main/LICENSE) | MIT licence terms |

`docs/release-checklist.md` is a maintainer gate list rather than user documentation. It
lives in the repository and is not reproduced here.

## Precedence

Where this site and a repository document disagree, the repository document wins. Site
pages are task-oriented explanations of the specifications, not replacements for them.
Report any disagreement you find as a documentation bug.

## Related

- [Contributing](./contributing.md)
- [Project status](./status.md)
