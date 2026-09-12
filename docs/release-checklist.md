# Release Checklist

This is the publication gate, not a claim that every gate has passed.
**Publication status (2026-09-12): source and documentation are public.** The
owner accepted the retained email disclosure and authorized publication after
green CI. The owner explicitly deferred all tags and GitHub prereleases.
The documentation and visual corrections shipped in `6169885` with green CI and
Pages deployment. Remaining verification limits are recorded below, not implied
complete or converted into production-readiness claims.

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
- [x] Publish the approved cleanup and initial claim corrections to `main`.
      Commit `e19fa2c0b4e0c0170be2be489868db9ba52aadd9` passed all seven jobs in
      [CI run 34696499687](https://github.com/patschmittdev/Ziggurat/actions/runs/34696499687),
      including the new clean-room and Linux ENOSPC steps.
- [x] Publish the full documentation review and visual corrections as
      `616988584e90b69cd37d2ad3474a321e72005d3f`.
      [CI run 34700745097](https://github.com/patschmittdev/Ziggurat/actions/runs/34700745097)
      passed all seven jobs on that exact `main` commit.
- [x] Audit the shipped source tree
      `34db3c719577506db15bdbf9113be9b9fbee214c` using the explicit clean-room
      command. The isolated 216-file source snapshot passed with no findings.
- [x] Scan that source snapshot and reachable `main` history with Gitleaks 8.30.1:
      no findings; 37 commits scanned. This supplements the retained-PR history
      scan below, not a guarantee of universal secret detection.
- [ ] Before any later release, repeat affected gates on its exact target commit.
      The visual gate is not part of either package's `npm run check`.

The initial checkout audit failed on existing ignored local logs and screenshots.
The cleanup follow-through preserved the 32 flagged files outside the repository,
verified each relocated file's SHA-256, and retained a restoration manifest.
The checkout audit now **passes** without any new exclusions or deletion of those
artifacts. The CI matrix now runs the explicit checkout audit after the core suite.
These workflow changes are published and passed in CI run 34696499687.
Git ignore is not a clean-room exclusion; generated files can make a later checkout
audit fail again. Do not archive the entire working directory as a substitute for
audited source-only contents.

## 2. Repository metadata and public claims

- [x] LICENSE, SECURITY.md, CONTRIBUTING.md, SUPPORT.md, and CODE_OF_CONDUCT.md
      exist, with issue forms and a pull request template.
- [x] Both packages retain `"private": true`; distribution is source-only.
- [x] Repository description and topics describe the memory boundary without
      implying production deployment. The homepage points to the verified Pages site.
- [x] Land the README, package homepage, reporting-channel, and site-status
      corrections, and verify the deployed homepage, support, and status pages.
- [x] Review all 22 documentation pages against current code, specifications,
      tests, and available measurements; correct the 15 identified documentation
      issues in the shipped follow-up.
      Do not infer human usability from staging success, human review from a
      signature, or factual truth from citation integrity.
- [x] Complete the requested Claude Opus documentation and problem-fit review.
      It supports an experimental reference release at the documented scope, not
      production use. Its actionable wording findings were corrected: model draft
      versus stored Silver, reporting availability, operator-managed Git, signed
      commit authority, downstream labels, and page authorship. This was an AI
      review, not an independent third-party security audit or human usability study.
- [x] Verify the repository's generated social-preview image returns HTTP 200.
      This is GitHub's default preview, not a claim that the tracked custom image
      was uploaded in repository settings. The site's own social-preview image
      also returns HTTP 200.

The first visual pass sampled four routes; it was not an all-page visual review.
The expanded suite discovers every documentation page and passed 138 combinations:
22 docs pages plus the homepage across three viewport sizes and two themes.
Manual desktop/mobile screenshot inspection covered all 22 docs pages. The
follow-up fixes the heading-wrapper separator defect, inconsistent navigation
styling, and mobile-menu expanded-state reporting. Passing these checks is not
a comprehensive accessibility certification or proof of every runtime behavior.

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
job repeated it successfully in CI run 34696499687. The full
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

Section 3 passed through informed consent, and the owner authorized the visibility
change after CI run 34696499687 succeeded. The repository is now public. Complete
the remaining gates before any later tagged release or broader announcement:

- [x] Enable private vulnerability reporting: API reports `enabled: true`.
      The public report URL reaches GitHub's normal sign-in flow.
- [ ] Verify the form from an independent signed-in non-maintainer account.
      This manual check is still unverified; no test report was submitted.
- [x] Enable secret scanning and push protection: both read back as enabled,
      with zero secret-scanning alerts at inspection.
      The hosted scan-history API returns HTTP 404 under this account, so hosted
      full-scan completion is not independently observable and is not claimed.
      An isolated local scan of fetched GitHub branches and PRs #1 through #17
      reported no leaks: 112 reachable commits, 108 scanned non-merge commits.
- [x] Enable and verify Dependabot alerts: HTTP 204; zero alerts returned on
      2026-09-12.
- [x] Enable and verify Dependabot security updates: `enabled: true`,
      `paused: false`. This does not imply scheduled version-update configuration.
- [x] Verify default Actions permissions: `read`, with workflow approval of pull
      request reviews disabled. Workflow-level permissions also remain explicit.
- [ ] Before a later tagged release, verify green CI on that exact target commit.

### Required main protection policy

The owner requires pull requests, one independent approving review, dismissal of
stale approvals, up-to-date required checks, and no administrator bypass.
Force pushes and deletion must be blocked. Required checks must come from GitHub
Actions (app ID `15368`), not merely share their names.

Protection is managed in GitHub settings, independently of this source document.
Verify the live policy with `gh api repos/patschmittdev/Ziggurat/branches/main/protection`
before a later release; a documented policy alone is not enforcement evidence.

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

- [x] Set Pages build source to **GitHub Actions**; HTTPS is enforced.
- [x] Restrict the `github-pages` environment to the `main` branch.
- [x] Verify initial public build and deployment:
      [run 34696983306](https://github.com/patschmittdev/Ziggurat/actions/runs/34696983306)
      succeeded on `e19fa2c`. The earlier private-repository run was skipped,
      and the earlier homepage HTTP 404 is historical, not current status.
- [x] Verify <https://patschmittdev.github.io/Ziggurat/>, a documentation route,
      stylesheets, logos, and the site social preview return HTTP 200.
- [x] Verify live Pagefind search: `authorization` returned 20 results under
      `/Ziggurat/`, including normal search-dialog results.
- [x] Inspect live light/dark and mobile rendering. This exposed visual defects
      subsequently corrected in the shipped follow-up; automated checks are not
      a claim that every possible visual or accessibility defect is absent.
- [x] Deploy the documentation and visual follow-up:
      [Pages run 34700745105](https://github.com/patschmittdev/Ziggurat/actions/runs/34700745105)
      succeeded on `6169885`; public HTML contains the corrected figures and status.
- [x] Advertise the verified live site in README.md, package metadata, and
      repository homepage settings.

## 6. Tagged pre-release: deferred by the maintainer

The current authorization is **public source and documentation only**. Do not
create a tag, GitHub prerelease, or announcement of a tagged release. These are
future steps, not actions authorized by this publication:

- [ ] Choose a prerelease tag from the exact green `main` commit.
- [ ] Mark the GitHub release as a pre-release.
- [ ] State source-only distribution, no npm publication, and compatibility
      instability before 1.0.
- [ ] Include measured evidence, human-acceptance status, retrieval limitations,
      operating profile, and unverified recovery cases in the release notes.
- [ ] Announce only after the reporting channel, protections, and live site work.

A visibility change and Pages publication were performed with owner approval.
No tag, GitHub release, or broader announcement was made.
