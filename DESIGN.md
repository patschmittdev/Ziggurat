---
name: Ziggurat Documentation Site
description: A cold technical plate for a human-gated memory firewall. Rules, fields, and evidence annotations, never marketing chrome.
colors:
  graphite-ground: "#101214"
  graphite-raised: "#181b1e"
  graphite-sunk: "#0a0c0d"
  graphite-ink: "#eceeec"
  graphite-ink-2: "#a9afb3"
  graphite-ink-3: "#8a9095"
  graphite-rule: "#2e3337"
  graphite-rule-strong: "#61686f"
  graphite-bronze: "#de9a6a"
  graphite-silver: "#96bad2"
  graphite-gold: "#e6b854"
  graphite-refuse: "#f49384"
  graphite-link: "#8fb6e8"
  mineral-ground: "#f2f2ef"
  mineral-raised: "#fafaf8"
  mineral-sunk: "#e7e7e3"
  mineral-ink: "#14171a"
  mineral-ink-2: "#4c5257"
  mineral-ink-3: "#666c71"
  mineral-rule: "#c3c6c1"
  mineral-rule-strong: "#7e837d"
  mineral-bronze: "#8c4a22"
  mineral-silver: "#3b5a6b"
  mineral-gold: "#7a5a0e"
  mineral-refuse: "#9b2a1e"
  mineral-link: "#1f4e8c"
  bronze-solid: "#8c4a22"
  silver-solid: "#3b5a6b"
  gold-solid: "#c8921f"
  refuse-solid: "#9b2a1e"
  on-bronze: "#fbf8f5"
  on-silver: "#f6fafc"
  on-gold: "#14171a"
  on-refuse: "#fdf6f4"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif"
    fontSize: "clamp(2.5rem, 1.45rem + 5.25vw, 5.25rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  heading:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "clamp(1.625rem, 1.35rem + 1.35vw, 2.375rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  body:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: "normal"
  machine:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
rounded:
  none: "0"
spacing:
  "3xs": "0.25rem"
  "2xs": "0.5rem"
  xs: "0.75rem"
  s: "1rem"
  m: "1.5rem"
  l: "2.25rem"
  xl: "3.5rem"
  "2xl": "5.5rem"
  "3xl": "8rem"
components:
  action:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.none}"
    padding: "0.5rem 1.5rem"
    height: "44px"
  action-hover:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.graphite-ink}"
  action-primary:
    backgroundColor: "{colors.graphite-ink}"
    textColor: "{colors.graphite-ground}"
    rounded: "{rounded.none}"
    padding: "0.5rem 1.5rem"
    height: "44px"
  action-primary-hover:
    backgroundColor: "{colors.graphite-ink-2}"
    textColor: "{colors.graphite-ground}"
  tier-chip-bronze:
    backgroundColor: "{colors.bronze-solid}"
    textColor: "{colors.on-bronze}"
    typography: "{typography.machine}"
    rounded: "{rounded.none}"
    padding: "0.15em 0.4em"
  tier-chip-silver:
    backgroundColor: "{colors.silver-solid}"
    textColor: "{colors.on-silver}"
    typography: "{typography.machine}"
    rounded: "{rounded.none}"
    padding: "0.15em 0.4em"
  tier-chip-gold:
    backgroundColor: "{colors.gold-solid}"
    textColor: "{colors.on-gold}"
    typography: "{typography.machine}"
    rounded: "{rounded.none}"
    padding: "0.15em 0.4em"
  tier-chip-refused:
    backgroundColor: "{colors.refuse-solid}"
    textColor: "{colors.on-refuse}"
    typography: "{typography.machine}"
    rounded: "{rounded.none}"
    padding: "0.15em 0.4em"
  stamp-refused:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-refuse}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.1em 0.5em"
  figure:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.graphite-ink-2}"
    rounded: "{rounded.none}"
    padding: "0"
---

# Design

This records the system as built in `site/`. It governs the custom homepage
(`site/src/pages/index.astro`), the framework-free components in
`site/src/components/`, and the Starlight documentation theme in
`site/src/styles/`. It was written from the shipped artifact, not from the plan.

## Overview

The surface is a **cold technical plate**: the drawing an engineer produces when
they section a structure and annotate what each layer does and what it cannot do.
It refuses the security-landing default of a hero, three icon cards, and a terminal
screenshot.

The one idea it owns: authority over durable memory is a capability the software
does not have. Every device serves that. Solid tier fields carry Bronze, Silver, and
Gold at page scale; a hairline rule separates two genuinely different things and
never decorates; monospace marks machine facts and nothing else; and a recessed gap
in the section drawing is the boundary the product is about.

Two themes are peers. **Graphite** is the default because the reading scene is an
engineer evaluating a threat model beside a dark editor. **Mineral** is a full
daylight rendition, not a tinted afterthought.

## Colors

Strategy: **full palette, four named roles** over a neutral field. The tier colors
are not accents scattered on a ground; they own whole regions of the section drawing
and the level index.

| Role | Meaning | Mineral | Graphite |
|---|---|---|---|
| Bronze | Preserved evidence | `#8c4a22` | `#de9a6a` |
| Silver | Staged proposal | `#3b5a6b` | `#96bad2` |
| Gold | Externally authorized reference data | `#7a5a0e` | `#e6b854` |
| Refuse | A refusal, a failed check, a thing with no authority | `#9b2a1e` | `#f49384` |

Solid fills (`bronze-solid`, `silver-solid`, `gold-solid`, `refuse-solid`) carry a
fixed foreground in both themes, so a filled plate never has to guess which ink sits
on it. Every text role clears WCAG 2.2 AA 4.5:1 on every ground it is used against;
`rule-strong` and the tier marks clear 3:1 for non-text contrast.

Theme resolution matches Starlight: an inline script sets `data-theme` on `<html>`
from the `starlight-theme` storage key. With scripting disabled no attribute is set,
so `prefers-color-scheme` governs and graphite remains the fallback. `color-scheme`
is declared for both themes so scrollbars and native controls follow.

**Gold is never a success, safety, or truth signal.** It labels the authorized tier
and nothing else. The reading cursor and the sidebar current-page marker are neutral
ink for exactly this reason.

## Typography

No web fonts. The site loads no third-party asset of any kind, so the system stack
does the work and is made to earn it through scale, weight, tracking, and register.

The ramp: `--zg-text--2` 0.75rem, `--zg-text--1` 0.8125rem, `--zg-text-0` 1.0625rem
(body), `--zg-text-1` 1.1875rem, `--zg-text-2` 1.4375rem, then three fluid steps
topping out at 5.25rem for the thesis.

Two registers, and the split is semantic rather than decorative:

- **Sans** carries human explanation: headings, prose, navigation, labels.
- **Monospace** carries machine facts only: paths, digests, field names and values,
  command names, configuration keys, and the datum scale numerals. In this product
  the difference between prose and a machine fact is the whole epistemology, so the
  typeface change is load-bearing. Monospace is never used as a costume for
  "technical".

Display tracking runs to `-0.035em`; headings to `-0.025em`. Body measure is capped
at 68ch. Headings use `text-wrap: balance`.

## Layout

A `78rem` page maximum with a fluid gutter (`clamp(1.25rem, 0.75rem + 2vw, 3rem)`)
that respects `env(safe-area-inset-*)`.

Vertical rhythm comes from one spacing scale on a 4px base. Sections are separated
by a `2xl` (5.5rem) block and a `rule-strong` hairline. More space sits above a
heading than below it.

Breakpoints as actually used: `40rem` (masthead compression), `48rem` (narrative
datum rail narrows), `52rem` (four-column ledger becomes labelled blocks), `60rem`
(title block and two-up comparisons), `64rem` (the narrative becomes sticky).

The signature layout is the **ascent**: on screens at or above `64rem` the section
drawing is `position: sticky` beside a scrolling list of seven levels. Below that it
is an ordinary stacked reading sequence with no sticky scrub, explanation first, and
no behaviour that depends on scroll position.

## Elevation & Depth

There is no shadow in this system, and that is a decision rather than an omission. A
plate is flat. Depth is expressed by three ground values (`sunk`, `ground`,
`raised`) and by rule weight: a hairline separates, a `rule-strong` hairline divides
sections, and a 3px double rule marks the one boundary the product is about.

The authorization gap in the section drawing is drawn as a recess: the ground colour
inside a raised figure, bounded by dashed lips.

## Shapes

Square. `border-radius: 0` everywhere, including inside Starlight's own chrome,
which is overridden. Rounded corners belong to product chrome; this surface is drawn
with a straightedge.

Rules are 1px. Meaningful boundaries use `rule-strong`; internal grid lines use
`rule`. Every rule must separate two things that are genuinely different; a rule used
for texture is a defect.

## Components

- **Title block.** The first viewport is a drawing title block: the thesis at display
  scale on the left, the project's real specification as a `dt`/`dd` grid on the
  right, hairline above. It is not a hero.
- **Boundary plate (Figure 1).** Two stacked fields, gold above and silver below,
  divided by a 3px double seam reading `NO CODE PATH CROSSES`, with the key entering
  from outside the frame. Real HTML text, not an image.
- **Section drawing (Figure 3).** Inline SVG, complete in the served markup, with a
  datum rail, seven annotated levels, solid tier courses, and a recessed gap.
- **Level index.** A monospace elevation number plus a solid tier chip in a ruled
  left rail. This is a measured datum, not an eyebrow: the reader is ascending a
  structure and the level is the fact that orders the sequence.
- **Actions.** Square, 44px minimum height, `rule-strong` border. The primary action
  inverts to solid ink. Hover raises contrast rather than adding colour.
- **Ledger.** Ruled `<table>` with uppercase small-caps headings, no zebra fill, and
  a labelled-block layout below `52rem` so nothing is dropped or side-scrolled.
- **Ledger pair.** Enforced guarantees beside explicit non-guarantees, headed by a
  2px rule in silver and refuse respectively. Never a card grid.
- **Artifact.** A bordered plate with a mono filename, a stamp, a scrollable
  `tabindex="0"` code block, and a plain-language note.

Motion is one authored moment and nothing else: a datum cursor that tracks the level
being read, easing on `cubic-bezier(0.16, 1, 0.3, 1)` over 620ms. It is **additive**
and dims nothing, so no text ever loses contrast to a scroll position. It runs only
at or above `64rem` and never under `prefers-reduced-motion`.

## Do's and Don'ts

**Do**

- Let a tier colour own a whole region when the region is about that tier.
- Reserve monospace for paths, digests, field values, commands, and measurements.
- Put the non-guarantee beside the guarantee. The limits are part of the argument.
- Keep every narrative fact in the served markup. Motion is enhancement only.
- Give a scrollable code region a focusable stop and an accessible name.

**Don't**

- Call Gold true, safe, verified, or authoritative. It is *externally authorized
  reference data*, and nothing it returns carries instruction authority.
- Use gold, or any tier colour, as a generic accent, highlight, or success state.
- Add a rounded corner, a shadow, a gradient, or a glass surface.
- Build a grid of equal cards with an icon, a heading, and three lines of text.
- Put an eyebrow label above a heading.
- Reproduce the poisoned fixture's instruction text. Describe it instead.
- Claim users, deployments, audits, benchmarks, or production maturity.
