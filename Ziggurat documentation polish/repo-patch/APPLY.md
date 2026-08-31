# Applying the docs-site polish to your branch

Files mirror the repository layout. From the worktree with
`patschmittdev-human-trust-boundary` checked out:

1. Extract this zip over the repo root (it only touches `site/`):
   - modified: site/src/pages/index.astro (reveal attrs + controller, new wordmark)
   - new:      site/src/styles/motion.css (section-entry motion, JS-ready gated)
   - modified: site/src/styles/home.css (hover grammar appended at end)
   - modified: site/src/components/AscentFigure.astro (gap-zone cleanup)
   - replaced: site/src/assets/ziggurat-mark-light.svg / ziggurat-mark-dark.svg
   - replaced: site/public/favicon.svg / social-preview.svg
2. Regenerate site/public/social-preview.png from the new social-preview.svg.
3. Run the checks:
   npm --prefix site run check
   npm run check
   node dist/src/cli/main.js check --root . --audit-clean-room
   git diff --check
4. Commit:
   git add site && git commit -m "Polish docs site: motion system, rebuilt mark, figure cleanup"

Note: these files were authored against PR #6 (patschmittdev-ziggurat-docs-site).
If your active branch has diverged in site/, review the diff before committing —
home.css changes are purely appended, index.astro changes are additive attributes
plus one script block and the wordmark SVG.
