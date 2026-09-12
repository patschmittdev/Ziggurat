# Release Checklist

This is the publication gate, not a claim that every gate has passed.
**Current verdict: HOLD pending launch controls (2026-09-12).** The owner has
accepted the retained email disclosure and authorized controlled public launch
after green CI. The final documentation and problem-fit review is complete.
Do not tag, create a public release, or announce the site before the remaining
launch gates pass.

The 2026-09-09 evidence at `164bc98` was historical evidence, not approval of a
later candidate. It remains available in repository history and PR #10. The
dated results below supersede its blanket completion marks.

## 1. Content and code gates

- [x] Merge PR #17. Merged on 2026-09-12 as
      `6cb69a1a19d6506bea89ccad7a11ab2787ca24eb`.
- [x] Obtain green CI on that exact `main` commit, not only the release branch.
      [Run 34692227810](https://github.com/patschmittdev/Ziggurat/actions/runs/34692227810)
      completed successfully on 2026-09-12: all six Linux/macOS/Windows and
      Node.js 22/24 combinations, plus `docs site`.
- [x] Run `npm run check` locally on the candidate runtime. Node.js 24.16.0:
      697 runtime tests, 695 passed, two platform-permission skips, no failures;
      all seven documentation-link tests passed, as did link and style checks.
      The final cleanup run also passed all eleven script tests, including four
      container-runner regressions for rejected path/image overrides and explicit
      failure without Docker.
- [x] Run `npm run site:check` on the local documentation corrections:
      type check, remark-link tests, production build, and built-output validation
      passed for 24 pages and eight stylesheets.
- [x] Audit both dependency lockfiles against current advisories:
      root and site `npm audit --json` each reported zero vulnerabilities.
      This is not a code audit or secret scan.
- [x] Audit isolated source contents for the green candidate and local corrections:
      both clean-room runs passed with no findings. The candidate source tree is
      `babeddf918afcbad467df44441fb84ef54223095`, equal to the merged `main` tree.
      The initial corrected snapshot contained 212 tracked files, not ignored local
      data. The cleanup adds two container-runner source/test files.
- [x] Run Gitleaks 8.30.1 with redacted reports: no findings in corrected source
      or the 38-commit local candidate history. The wider 260-commit local-ref scan
      flagged one generated synthetic retrieval chunk ID in a checkpoint report;
      inspection confirmed it was not a credential. No scanner exclusions were added.
      These local scans do not inspect GitHub's retained PR objects or replace
      hosted secret scanning.
- [x] Run `git diff --check`, the garden walkthrough, and current CLI smoke checks.
      `init` and `ingest` completed through the walkthrough; `review`, `build`,
      `query`, `eval`, `check`, and all command help forms succeeded.
      `build --promote` was rejected. The walkthrough stopped at external signing.
- [x] Run the additional local site visual gate in an isolated copy: 24/24 checks
      passed across four routes, three viewport sizes, and light/dark themes.
      It checks overflow, a single H1, and automated WCAG 2 A/AA rules and captures
      screenshots; it is not a complete manual accessibility audit.
- [ ] Commit and publish the validated source, documentation, and CI corrections with explicit
      maintainer approval, then require green CI on the resulting `main` commit.
      The maintainer authorized switching to `main`, committing, and pushing on
      2026-09-12. The green run above does not cover these uncommitted corrections.
- [ ] Audit the exact final publication tree and record its identity using
      `node dist/src/cli/main.js check --root <publication-tree> --audit-clean-room`.
      Audit source contents, not a directory containing local measurement logs.
- [ ] Complete a suitable secret scan and manual private-data review of the final
      tree and publication history. The clean-room audit is heuristic, skips
      symlinks, and is not a generic secret scanner.
- [ ] Repeat the affected content gates if the final publication snapshot changes.
      The visual gate is not part of either package's `npm run check`.

The initial checkout audit failed on existing ignored local logs and screenshots.
The cleanup follow-through preserved the 32 flagged files outside the repository,
verified each relocated file's SHA-256, and retained a restoration manifest.
The checkout audit now **passes** without any new exclusions or deletion of those
artifacts. The CI matrix now runs the explicit checkout audit after the core suite.
These workflow changes still require publication and a green remote run.
Git ignore is not a clean-room exclusion; generated files can make a later checkout
audit fail again. Do not archive the entire working directory as a substitute for
audited source-only contents.

## 2. Repository metadata and public claims

- [x] LICENSE, SECURITY.md, CONTRIBUTING.md, SUPPORT.md, and CODE_OF_CONDUCT.md
      exist, with issue forms and a pull request template.
- [x] Both packages retain `"private": true`; distribution is source-only.
- [x] Repository description and topics describe the memory boundary without
      implying production deployment. The repository homepage is currently empty.
- [ ] Land the README, package homepage, reporting-channel, and site-status
      corrections. Until Pages is verified, link to repository documentation
      rather than advertise a live site.
- [ ] Recheck all public statements against the final code and measurements.
      Do not infer human usability from staging success, human review from a
      signature, or factual truth from citation integrity.
- [x] Complete the requested Claude Opus documentation and problem-fit review.
      It supports an experimental reference release at the documented scope, not
      production use. Its actionable wording findings were corrected: model draft
      versus stored Silver, reporting availability, operator-managed Git, signed
      commit authority, downstream labels, and page authorship. This was an AI
      review, not an independent third-party security audit or human usability study.
- [ ] Confirm the social preview in repository settings. A tracked image alone
      does not verify that the setting is configured.

### Measured evidence and limits

| Area | Evidence | Limit that must remain visible |
| --- | --- | --- |
| Model workflow | [Two separately reported batches](model-workflow-evaluation.md): initial 79/90 staged; explicit-coordinate revision 90/90 | No human usability ratings; revised batch reused fixtures that informed the fix |
| Retrieval | [Synthetic evaluation](retrieval-evaluation.md): exact-identifier holdout top-1 4/8 to 8/8; Recall@5 0.822917 to 0.906250 | No-answer false positives remain 4/6; no general abstention claim |
| Operating envelope | [Reference Windows workload](operating-envelope.md): 1,000 Gold / 5,000 Bronze / 1,000 proposals, explicit 512 MiB old-space, search/read p95 731/723 ms, peak RSS 806,932,480 bytes | Default-heap RSS failed; not a universal capacity guarantee |
| Recovery | [Real-file crash, concurrency, revocation, out-of-envelope recovery, and actual ENOSPC](operating-envelope.md) | ENOSPC passed on a 48 MiB Linux tmpfs; native Windows disk-full recovery remains unverified |
| Signing | [Independent Python/Node interoperability](external-signing-interop.md) | Disposable software-boundary evidence, not human review or a shipped signer |

The real-model acceptance gate remains pending: at least 72/90 human-scored usable
proposals, with a usable example of each operation, are required in addition to
81/90 staging. Only actual human judgments can complete that gate. No adoption,
third-party audit, or production maturity is claimed.

The signed-vault retrieval evaluation was rerun on 2026-09-12 and reproduced
8/8 identifier holdout top-1, Recall@5 0.906250, and 4/6 no-answer false positives.
The independent Python `cryptography` 50.0.0 interoperability test also passed
again. The expensive real-model and capacity experiments were not rerun in this
publication pass; their reports remain separately dated development evidence.

The cleanup follow-through also ran `npm run test:disk-full:container` on a
constrained, disposable Linux tmpfs. Actual `ENOSPC`, preservation of the previous
index, and subsequent replacement after releasing space passed. The Ubuntu/Node 24
job is wired to repeat it, but that workflow change is still local. The full
platform and isolation scope is in the operating-envelope report.

## 3. History hygiene and disclosure

Rewriting branch history does not remove GitHub's retained PR references, cached
commit views, forks, or other people's clones.

- [x] Recheck ordinary locally reachable commit author/committer metadata:
      only noreply addresses were observed.
- [x] Resolve retained historical disclosure before changing visibility.
      A fresh GitHub API check of PRs #1 through #17 found personal email
      metadata in 19 commits retained by PR #1. The owner explicitly confirmed
      ownership of the affected email address and consented to its public
      disclosure through retained commit and PR history on 2026-09-12.
- [x] Complete one authorized resolution: verified GitHub-supported removal,
      publication from an independently audited clean repository while this one
      remains private, or explicit informed consent from the affected data owner.
      The selected resolution is informed consent, not removal or a clean
      replacement repository. Do not describe the retained metadata as purged.
- [x] Record the scope of the resolution. The retained references remain on
      GitHub and may expose the accepted email metadata after publication.
      Consent does not authorize disclosure of credentials or private vault data;
      source and history publication audits remain separate gates.

The [GitHub-supported removal procedure](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
requires Support to remove retained references and cached views. Support determines
eligibility; removal is not guaranteed for every metadata request.
The Support portal was reached but required interactive GitHub sign-in. No ticket
was submitted and no removal was verified. Zero forks were reported at inspection;
that is not proof that no private clone exists.

## 4. Controlled visibility and repository settings

Keep visibility private until section 3 passes. Do not make the repository public
merely to unlock settings. After authorized visibility change, complete these gates
before tagging or announcing:

- [ ] Enable private vulnerability reporting and verify the report form from a
      non-maintainer account before advertising it as available. Current status:
      GET and enable attempts return HTTP 404 on this private repository.
- [ ] Enable secret scanning and push protection; verify both enabled states,
      scan completion, and review findings. Current status: alert access says
      scanning is disabled; activation returns HTTP 422, feature unavailable.
- [x] Enable and verify Dependabot alerts: HTTP 204; zero alerts returned on
      2026-09-12.
- [x] Enable and verify Dependabot security updates: `enabled: true`,
      `paused: false`. This does not imply scheduled version-update configuration.
- [ ] Protect `main` with a ruleset or branch protection requiring pull requests,
      review, and the seven actual CI job contexts below. Block force pushes and
      deletion; document any deliberately granted bypass. Current read attempts
      return HTTP 403 requiring GitHub Pro or public visibility.
- [x] Verify default Actions permissions: `read`, with workflow approval of pull
      request reviews disabled. Workflow-level permissions also remain explicit.
- [ ] Rerun and verify CI on the final public `main` commit after all corrections.

Required check contexts:

```text
test (ubuntu-latest, 22)
test (ubuntu-latest, 24)
test (windows-latest, 22)
test (windows-latest, 24)
test (macos-latest, 22)
test (macos-latest, 24)
docs site
```

Do not require a nonexistent check named `ci`; that is the workflow name.
Record the configured rules and verify enforcement, not just a saved settings form.

## 5. Documentation site publication

The `pages` workflow remains gated on explicit public visibility for both jobs.
Missing or unexpected visibility fails closed. Do not remove this guard.

- [ ] Set Pages build source to **GitHub Actions** after authorized publication.
      Current API result is HTTP 404 and repository metadata says `has_pages: false`.
- [ ] Configure any desired `github-pages` environment protection.
- [ ] Run `pages` on the final `main` and verify both build and deploy succeed.
      [Run 34692227763](https://github.com/patschmittdev/Ziggurat/actions/runs/34692227763)
      was correctly skipped while private; a skip is not a successful deployment.
- [ ] Verify <https://patschmittdev.github.io/Ziggurat/> and a documentation route,
      stylesheet, logo, and in-page navigation. The homepage returned HTTP 404 on
      2026-09-12.
- [ ] Verify live Pagefind search returns results under the `/Ziggurat/` base path.
- [ ] Verify light/dark themes and mobile rendering on the deployed site.
- [ ] Only then advertise the live site in README.md, package metadata, and
      repository homepage settings.

## 6. First tagged pre-release

Only after the applicable gates above pass and the maintainer explicitly approves
the remaining engineering limitations:

- [ ] Choose a prerelease tag from the exact green `main` commit.
- [ ] Mark the GitHub release as a pre-release.
- [ ] State source-only distribution, no npm publication, and compatibility
      instability before 1.0.
- [ ] Include measured evidence, human-acceptance status, retrieval limitations,
      operating profile, and unverified recovery cases in the release notes.
- [ ] Announce only after the reporting channel, protections, and live site work.

No tag, GitHub release, visibility change, or announcement was performed in this pass.
