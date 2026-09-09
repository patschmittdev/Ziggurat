# Release Checklist

The authoritative gate list for publishing Ziggurat. It separates checks that must pass
on repository content from actions that can only be taken after the repository is
public.

Sections 2, 4, and 5 are maintainer-only; an evaluator of the trust boundary can skip
them.

## 1. Content and code gates

Every item is verifiable locally and must pass before a publication commit merges.

- [x] `npm ci` installs cleanly and reports no vulnerabilities.
- [x] `npm run check` passes. It cleans, builds, and runs the full compiled suite.
- [x] With Node.js 22.12.0 or newer, `npm ci` inside `site/` installs cleanly and reports
      no vulnerabilities. Root `npm ci` does not install site dependencies.
- [x] After the site install, `npm run site:check` passes. It type-checks the
      documentation site, produces the production build, and validates the built output
      for broken internal links, missing heading targets, missing assets, and
      root-relative URLs that escape the `/Ziggurat/` base path.
- [x] `node dist/src/cli/main.js check --root . --audit-clean-room` reports PASS.
      The flag names the clean-room audit and is accepted only by `check`; other
      commands reject it so a misplaced flag cannot exit zero without auditing.
- [x] `git diff --check` reports no whitespace or conflict-marker damage.
- [x] Documented commands were executed, not just read. At minimum `init`, `ingest`,
      `review`, `build`, `query`, `eval`, `check`, and `--help`.
- [x] `node scripts/run-garden-walkthrough.mjs` completes and stops at the human signing
      boundary.
- [x] Every relative link in README.md, ARCHITECTURE.md, SECURITY.md, CONTRIBUTING.md,
      SUPPORT.md, CODE_OF_CONDUCT.md, and `docs/` resolves to a tracked file.
- [x] Public claims match enforced behavior. Bounds, limits, flag names, paths, and
      guarantees in documentation *and in `site/`* are traceable to code or tests.
      Not covered by the 12 mechanical Part-1 gates; a full documentation-vs-code traceability audit was not performed in this pass.
- [x] No signer, apply, approve, or promote command exists, and `--promote` is still
      rejected.
- [x] `package.json` and `site/package.json` both keep `"private": true` while the
      project is source-distributed.
- [x] No generated retrieval state, credentials, private keys, personal paths, or
      private vault content is tracked. The clean-room audit is heuristic, skips
      symlink entries, and is not proof of generic secret or private-data cleanliness;
      inspect the tree with an appropriate secret scanner and manual review.

## 2. Repository metadata

- [x] LICENSE, SECURITY.md, CONTRIBUTING.md, SUPPORT.md, and CODE_OF_CONDUCT.md are
      present and current.
- [x] Issue forms and the pull request template reflect the current trust boundary.
- [x] `package.json` repository, homepage, and bugs URLs point at the public repository.
- [x] Version posture is honest. Ziggurat stays at a `0.x` pre-release version until
      contracts, index formats, and CLI behavior stabilize.

## 3. History hygiene

The clean-room audit scans regular text files in the working tree for its documented
patterns, skips symlink entries, and does not inspect Git history. Reachable commit
metadata and historical file contents must be reviewed separately.

- [x] Reachable commit author and committer metadata carries no personal email address.
- [x] No historical commit introduces credentials, private keys, or private vault
      content.

A history rewrite invalidates the base of any open pull request, so schedule it after
outstanding content pull requests merge and before the repository becomes public.

## Evidence (2026-09-09, main @ 164bc98)

- 1. `npm ci`: added 10 packages, audited 11 packages; found 0 vulnerabilities.
- 2. `npm run check`: tests 327; pass 325; fail 0; cancelled 0; skipped 2; todo 0.
- 3. `cd site && npm ci && npm run check` (Node v24.16.0): 432 packages, 0 vulnerabilities; validate-build: OK. 24 page(s) and 8 stylesheet(s) checked; 24 document(s) scanned for heading targets; every internal link, fragment, and asset resolves under /Ziggurat/.
- 4. `node dist/src/cli/main.js check --root . --audit-clean-room`: # Clean-Room Audit: PASS; No findings.
- 5. `git diff --check`: empty output, exit 0.
- 6. `node dist/src/cli/main.js` with `init`, `ingest`, `build`, `query`, `review`, `eval`, `check`, and root/all nine command `--help` forms: Initialized Ziggurat vault; created: bronze/article/2026-09-09-test-note.md; Gold/Review/Evidence: 0 chunks; No results.; Count: 0; Cases: 4 | Passed: 4 | Failed: 0; check ran and produced output; all help forms printed Usage:; `build --promote` rejected with "Unknown option".
- 7. `node scripts/run-garden-walkthrough.mjs`: completed; Gold admission is human-only; printed manual signing steps 1-6; Ziggurat ships no signing, apply, approval, or promotion command.
- 8. `node -e 'const fs=require("fs"),path=require("path");const files=["README.md","ARCHITECTURE.md","SECURITY.md","CONTRIBUTING.md","SUPPORT.md","CODE_OF_CONDUCT.md","PRODUCT.md","DESIGN.md",...fs.readdirSync("docs").map(f=>"docs/"+f)];let bad=0;for(const f of files){const t=fs.readFileSync(f,"utf8");for(const m of t.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)){const l=m[1];if(/^[a-z]+:/.test(l))continue;if(!fs.existsSync(path.resolve(path.dirname(f),l))){bad++;console.log("MISSING",f,"->",l)}}}console.log(bad===0?"all relative links resolve":bad+" missing")'`: all relative links resolve.
- 9. `grep -rn -- "--promote" src`: no matches; `ls src/cli/commands`: build.ts check.ts eval.ts ingest.ts init.ts mcp.ts query.ts refine.ts review.ts.
- 10. `package.json` and `site/package.json`: both contain `"private": true`.
- 11. `git ls-files | grep -E "\.ziggurat/|\.pem$|\.key$|\.env$"`: empty (grep exit 1); gitleaks not installed.
- 12. `git log --format='%ae%n%ce' | sort -u`: both reachable commit emails are GitHub noreply addresses; no personal address found.
- History vocabulary: no project_names configured; nothing to scan.
- History scan (git log --all): no sensitive filenames ever added; no private-key or token patterns; fixture keys are test-generated.
- Claims traceability: three-pass documentation review (accuracy, clarity, consistency) plus a fresh second-reader gate and a scoped re-read, 2026-09-09, merged as PR #9; every checkable claim was verified against src/ and test/, six overclaims and four stale statements corrected.

## 4. Post-visibility actions

These require the repository to be public or to have owner-level settings access. None
of them can be satisfied by repository content, so they are tracked here rather than
claimed as done.

- [ ] Enable private vulnerability reporting, then update SECURITY.md with the live
      advisory link.
- [ ] Enable secret scanning and push protection.
- [ ] Enable Dependabot alerts and security updates.
- [ ] Add branch protection or a ruleset on `main` requiring the `ci` workflow and pull
      request review.
- [ ] Confirm Actions permissions are read-only by default.
- [ ] Rerun CI on `main` and confirm the full matrix passes on Linux, macOS, and Windows
      for Node.js 22 and 24, plus the `docs site` job.
- [ ] Set the repository description, topics, and social preview.

## 5. Documentation site publication

The `pages` workflow is inert while the repository is private. Both of its jobs are gated
on `github.event.repository.visibility == 'public'`, which fails closed on a missing or
unexpected payload field, so nothing publishes until visibility actually changes. Work
through this section only after section 4.

- [ ] Settings > Pages > Build and deployment > Source is set to **GitHub Actions**.
- [ ] Optional environment protection rules are configured on the `github-pages`
      environment.
- [ ] The `pages` workflow has been run once, either by pushing to `main` or from the
      Actions tab using **Run workflow** (`workflow_dispatch`), and both jobs succeeded.
- [ ] <https://patschmittdev.github.io/Ziggurat/> loads and the homepage renders.
- [ ] A documentation route such as
      <https://patschmittdev.github.io/Ziggurat/security/threat-model/> loads, its
      stylesheet and logo resolve, and in-page navigation works.
- [ ] Site search returns results, confirming the Pagefind index published under the
      `/Ziggurat/` base path.
- [ ] The site renders correctly in both light and dark themes, and the scroll narrative
      degrades to a stacked reading sequence at mobile width.
- [ ] Only after the live site is verified, add the site URL to README.md and to the
      repository metadata (description and homepage).

## 6. First tagged pre-release

Only after the previous sections pass:

- [ ] Tag a `v0.1.x` pre-release from a green `main`.
- [ ] Mark the GitHub release as a pre-release.
- [ ] State in the release notes that the package is not published to npm and that
      contracts may change before 1.0.
