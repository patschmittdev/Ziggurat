# Release Checklist

The authoritative gate list for publishing Ziggurat. It separates checks that must pass
on repository content from actions that can only be taken after the repository is
public.

## 1. Content and code gates

Every item is verifiable locally and must pass before a publication commit merges.

- [ ] `npm ci` installs cleanly and reports no vulnerabilities.
- [ ] `npm run check` passes. It cleans, builds, and runs the full compiled suite.
- [ ] With Node.js 22.12.0 or newer, `npm ci` inside `site/` installs cleanly and reports
      no vulnerabilities. Root `npm ci` does not install site dependencies.
- [ ] After the site install, `npm run site:check` passes. It type-checks the
      documentation site, produces the production build, and validates the built output
      for broken internal links, missing heading targets, missing assets, and
      root-relative URLs that escape the `/Ziggurat/` base path.
- [ ] `node dist/src/cli/main.js check --root . --audit-clean-room` reports PASS.
      The flag names the clean-room audit and is accepted only by `check`; other
      commands reject it so a misplaced flag cannot exit zero without auditing.
- [ ] `git diff --check` reports no whitespace or conflict-marker damage.
- [ ] Documented commands were executed, not just read. At minimum `init`, `ingest`,
      `review`, `build`, `query`, `eval`, `check`, and `--help`.
- [ ] `node scripts/run-garden-walkthrough.mjs` completes and stops at the human signing
      boundary.
- [ ] Every relative link in README.md, ARCHITECTURE.md, SECURITY.md, CONTRIBUTING.md,
      SUPPORT.md, CODE_OF_CONDUCT.md, and `docs/` resolves to a tracked file.
- [ ] Public claims match enforced behavior. Bounds, limits, flag names, paths, and
      guarantees in documentation *and in `site/`* are traceable to code or tests.
- [ ] No signer, apply, approve, or promote command exists, and `--promote` is still
      rejected.
- [ ] `package.json` and `site/package.json` both keep `"private": true` while the
      project is source-distributed.
- [ ] No generated retrieval state, credentials, private keys, personal paths, or
      private vault content is tracked. The clean-room audit is heuristic, skips
      symlink entries, and is not proof of generic secret or private-data cleanliness;
      inspect the tree with an appropriate secret scanner and manual review.

## 2. Repository metadata

- [ ] LICENSE, SECURITY.md, CONTRIBUTING.md, SUPPORT.md, and CODE_OF_CONDUCT.md are
      present and current.
- [ ] Issue forms and the pull request template reflect the current trust boundary.
- [ ] `package.json` repository, homepage, and bugs URLs point at the public repository.
- [ ] Version posture is honest. Ziggurat stays at a `0.x` pre-release version until
      contracts, index formats, and CLI behavior stabilize.

## 3. History hygiene

The clean-room audit scans regular text files in the working tree for its documented
patterns, skips symlink entries, and does not inspect Git history. Reachable commit
metadata and historical file contents must be reviewed separately.

- [ ] Reachable commit author and committer metadata carries no personal email address.
- [ ] No historical commit introduces credentials, private keys, or private vault
      content.

A history rewrite invalidates the base of any open pull request, so schedule it after
outstanding content pull requests merge and before the repository becomes public.

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
