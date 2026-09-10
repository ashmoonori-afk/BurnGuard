/**
 * Per-type skill text injected into the prompt by `prompt-builder.ts`.
 * Prototype projects produce `index.html` and linked pages rendered in the
 * canvas iframe. This skill teaches the CLI what a polished website /
 * hero prototype looks like inside our constraints — plain HTML +
 * inline CSS + vanilla JS, no framework, no bundler.
 *
 * Keep this tight — it ships on every turn for a prototype project.
 * Keep the core skill within 5 KB; navigation is a shared delivery contract.
 *
 * Design-system boundary: STRUCTURE only — section archetypes, content
 * strictness, node-id contracts, interaction conventions. Colour,
 * typography, and palette choices live in `colors_and_type.css` and
 * must NOT be re-declared here.
 */
export const PROTOTYPE_SKILL_MD = `# Prototype authoring conventions

## Artifact contract

- The homepage is \`index.html\` at the project root. Each page has CSS in a top
  \`<style>\` block and JS inline before \`</body>\`.
- No React, Vue, Svelte, Tailwind classes, or bundler-only syntax (no
  JSX, no \`import\` of npm modules). Plain HTML / CSS / vanilla JS only.
- External CDN \`<script>\` tags allowed only on explicit user request.

## Default page structure

- Unspecified homepages default to: navbar → hero → features → social proof
  → pricing or secondary feature → CTA banner → footer (4–7 sections).
- Top-level blocks are \`<section data-section="<archetype>">\` direct
  children of \`<body>\`, except navbar (\`<header>\`) and footer
  (\`<footer>\`). Wrap the body sections in a single \`<main>\`.

## Per-section content rules (strict)

- Hero headline ≤ 10 words; subheadline ≤ 20 words; one primary CTA.
- Feature grids: 3–6 cards; title ≤ 5 words, body ≤ 25 words per card.
- Testimonials: quote ≤ 30 words + attribution (name, role, company).
- Pricing: 2–4 tiers; ≤ 6 feature bullets per tier, ≤ 10 words each.
- CTA banner: one sentence + verb-first button ≤ 4 words.
- Break dense blocks into list items or multiple cards. No walls of text.

## Section archetypes (pick one per section via \`data-section\`)

- \`hero-centered\` — large centered headline + subheadline + single CTA.
- \`hero-split\` — copy left, product shot or illustration right.
- \`hero-video\` — full-bleed loop + dark overlay + centered copy.
- \`feature-grid-3\` — 3-column responsive cards (icon + title + body).
- \`feature-alternating\` — image/text rows flipping L↔R every row.
- \`logo-strip\` — horizontal monochrome row of customer logos.
- \`quote-hero\` — oversized pull quote + attribution, calm background.
- \`testimonial-grid\` — 2–3 column testimonial cards.
- \`pricing-tiered\` — side-by-side tier cards, "popular" tier highlighted.
- \`stats-row\` — 3–4 oversized numbers + labels, thin dividers.
- \`faq-accordion\` — disclosure pattern using \`<details><summary>\`.
- \`cta-banner\` — narrow band, one sentence + button, edge-to-edge.
- \`footer-minimal\` — three-column logo / link groups / legal.

## Visual hierarchy

- Prefer asymmetric layouts outside heroes; reveal detail progressively and
  never hide primary value behind a scroll.

## Spatial layout vocabulary

- \`scroll-owner\`: exactly one element owns each scroll axis; the page owns vertical by default.
- Put \`overflow-x\`/\`overflow-y\` on that owner; ancestors must not share that axis.
- Nested scroll needs explicit interaction intent and bounds, never just clipping.
- \`wrap-first\`: try \`flex-wrap\` or Grid \`repeat(auto-fit, minmax(...))\` before breakpoints.
- Let space and item minimums drive reflow.
- Add a breakpoint only when reflow changes structure, not for ordinary wrapping.
- \`load-bearing\`: name the CSS property enforcing each layout decision.
- Mark nearby \`/* load-bearing: decision — property */\`, e.g. \`grid-template-columns\`, \`flex-wrap\`, or \`overflow-*\`.
- Preserve it during edits or replace its enforcement deliberately.

## Interaction conventions

- For scroll reveals, one \`IntersectionObserver\` toggles \`[data-revealed]\`.
- Keep JS under ~100 lines.

## Node IDs (required for edit / comment modes)

- Every visible text element carries
  \`data-bg-node-id="<section>-<purpose>"\` — e.g. \`hero-headline\`,
  \`hero-cta\`, \`feature-2-title\`, \`footer-copyright\`. No duplicates.
- Parent sections get \`data-bg-node-id="<section>"\` (\`hero\`, \`features\`,
  \`pricing\`).

## Styling

- All CSS inline in one top \`<style>\` block.
- Reference \`colors_and_type.css\` tokens by CSS variable name. Do not
  hardcode colours, font families, or scales that exist as tokens.
- Do not introduce new palettes, font stacks, or typefaces. The design
  system owns visual identity; archetypes describe STRUCTURE only.
- Icons (LUCIDE_ICON_REFERENCE): on demand, Read \`packages/backend/src/harness/assets/lucide/reference.md\`. Use only its inline \`<svg>\`; keep \`stroke="currentColor"\` and size with \`--icon-size\`. Never use external URLs, sprites, or icon fonts.
- Mobile first; reflow at 320 CSS pixels. Tables and diagrams may use bounded
  two-dimensional scrolling only when their relationships require it.
- Interactive targets are at least 24 by 24 CSS pixels or have equivalent spacing.
- Pair color-coded status with text, sign, shape, or pattern cues.
- Disable nonessential animation and smooth scrolling in
  \`@media (prefers-reduced-motion: reduce)\`.
- Use \`@media (min-width: 640px)\` for tablet and \`(min-width: 1024px)\` for desktop.

## Video & media

- When requested, \`<video>\` / \`<iframe>\` must include a poster or inline
  fallback; warn that external URLs may fail in canvas or capture.
- Never embed secrets or API keys.

## Don'ts

- No React, Vue, Svelte, Next.js, Vite, \`npm install\`, or external packages.
- No files outside the project directory, token overrides, secrets, or API keys.
`;

export const PROTOTYPE_NAVIGATION_CONTRACT = `## Website navigation contract
- For a new website prototype or a request to expand its navigation, create the homepage and the core subpages implied by the requested user journey, each with distinct useful content. Respect an explicit single-page or single-screen request. A scoped edit must preserve other pages and must not add unrelated subpages.
- Keep \`index.html\` as home and author real local HTML files such as \`about.html\` or \`products/detail.html\`. Use relative links such as \`about.html\` and \`../index.html\` in the same preview; no client router or local server setup is needed. Do not use root-relative paths or \`target="_blank"\` for site navigation.
- Every page is self-contained and uses \`<header data-bg-shared="header">\`, \`<nav data-bg-shared="nav">\`, \`<footer data-bg-shared="footer">\`, and \`<main data-bg-content>\`. Mark exactly the current nav link with \`aria-current="page"\`. The single top \`<style>\` separates reusable rules after \`/* @bg-shared-css */\` from page-specific rules after \`/* @bg-page-css */\`.
- Share identity while giving subpages distinct content layouts. Do not use root-absolute asset paths or include jQuery. Propagate a shared header, navigation, footer, or shared-CSS change to every page in the site map.
- When \`## Active page\` is present, edit that file unless the request explicitly names another file. An explicit comment-edit file in the request is authoritative.
- Share the visual language and navigation across pages, mark the current page, and provide a working link back home. Link only to authored pages; fragment links are allowed when the destination section exists. Never use \`href="#"\` as a substitute for a promised page.
- Open every authored page at desktop and narrow widths, exercise its primary links and the return-home path, and fix missing pages, assets or layout failures before reporting completion.
`;
