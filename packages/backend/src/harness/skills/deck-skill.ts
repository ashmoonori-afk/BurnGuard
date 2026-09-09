/**
 * Per-type skill text injected into the prompt by `prompt-builder.ts`.
 * Slide-deck projects need extra conventions beyond a generic HTML prototype
 * so the CLI produces something the deck runtime, exporters, and edit/comment
 * modes can all consume.
 *
 * Keep this tight — it ships on every turn for a slide_deck project. Current
 * size ~4 KB; re-measure before adding new sections.
 *
 * Design-system boundary: STRUCTURE only — layout archetypes, content
 * strictness, node-id contracts. Colour, typography, and palette choices
 * live in `colors_and_type.css` and must NOT be re-declared here.
 */
export const DECK_SKILL_MD = `# Slide deck authoring conventions

\`deck.html\` serves canvas, PDF, and PPTX exports. Deviations break them.

## Structure

- Each slide is a top-level \`<section data-slide data-layout="<archetype>">\`
  directly inside \`<body>\`. No wrapper divs.
- Reuse template classes (\`deck-slide\`, \`deck-cover\`, \`deck-closing\`).
- Select the narrative from the machine-readable research purpose and
  \`<burnguard-design-brief-v1>\` objective: company, sales, report, training,
  or pitch. If no purpose is resolved, use a neutral objective-led outline;
  never silently default to an investor pitch.

## Per-slide content rules (strict)

- Title ≤ 8 words; benefit-oriented or question-driven.
- 2–4 bullets per slide; each ≤ 12 words, full idea (not fragment).
- One takeaway per slide. Two takeaways = two slides.
- Data slides: \`<small class="deck-source">\` footnote + one-sentence
  takeaway near the chart.
- Never use the same \`data-layout\` on three consecutive slides.

## Layout archetypes (pick one per slide via \`data-layout\`)

- \`cover\` — oversized title + thin eyebrow; no bullets.
- \`agenda\` — numbered list (01/02/03), thin dividers.
- \`two-column-problem-solution\` — thick vertical divider; L=problem, R=solution.
- \`photo-list-split\` — 50/50 image + bold heading list.
- \`big-number\` — narrow narrative left, oversized metric right.
- \`vertical-timeline\` — thin vertical axis, stages branching L/R.
- \`three-step-columns\` — 01·02·03 typographic pillars, no icons.
- \`arrow-steps\` — horizontal process, text inside arrows.
- \`quote-callout\` — display-size pull quote + attribution.
- \`logo-grid\` — monochrome logo wall.
- \`chart\` — thin axes, dot terminators, source footnote, takeaway line.
- \`closing\` — short CTA / contact; visually mirrors \`cover\`.

## Visual hierarchy

- Prefer asymmetric layouts; avoid centered-everything.
- Whitespace is a feature. Let oversized type / numbers breathe.
- Progressive disclosure: overview slide first, then 2–3 detail slides.

## Projection scale

- Declare and use \`--deck-type-hero: 80px; --deck-type-heading: 52px; --deck-type-body: 32px; --deck-type-caption: 24px\` and \`--deck-pad-slide: 72px; --deck-pad-block: 32px\`.
- Set \`.deck-slide { font-size: var(--deck-type-body) }\` so unstyled text
  inherits the scale; every other \`font-size\` is \`var(--deck-type-*)\` (or a
  \`calc()\` that scales one up), never a raw px value.
- At 1920x1080, no rendered text may be below \`24px\`.
- In self-review, do not shrink type or tighten spacing toward web density.
  Projection readability wins.

## Runtime contract

- Keep \`<script src="/runtime/deck-stage.js" defer></script>\` right before
  \`</body>\`. The runtime owns navigation and keyboard/hash routing — do
  not reimplement.
- \`data-active\` is runtime-managed — never set it in static HTML.
- Respect \`body[data-deck-ready]\` CSS: before load slides stack, after
  only the active slide renders.

## Node IDs (required for edit / comment modes)

- Every visible text element carries \`data-bg-node-id="slide-{N}-{purpose}"\`
  (e.g. \`slide-3-title\`, \`slide-3-bullet-2\`). No duplicates across slides.
- Parent sections: \`data-bg-node-id="slide-{N}"\`.

## Styling

- All CSS inline in the top \`<style>\` block of \`deck.html\`.
- Reference \`colors_and_type.css\` tokens by CSS variable name. Do not
  hardcode colours, font families, or scales that exist as tokens.
- Do not introduce new palettes, font stacks, or typefaces. The design
  system owns visual identity; archetypes above describe STRUCTURE only.
- Icons (LUCIDE_ICON_REFERENCE): Read \`packages/backend/src/harness/assets/lucide/reference.md\`. Use its inline \`<svg>\` with \`stroke="currentColor"\` and \`--icon-size\`; no external sources.
- Keep \`.deck-slide { aspect-ratio: 16 / 9 }\` unless the user requests
  otherwise.
- When PowerPoint/PPTX output is requested, stay text-first: use real HTML text,
  simple shapes, and flat layouts; avoid effects that only survive raster capture.

## Speaker notes (optional)

- If \`use_speaker_notes\` is true, include
  \`<aside class="deck-notes" data-speaker-notes>\` inside every slide.
  Shown only in presenter mode (\`?present\`).

## Don'ts

- No external fonts or JS libraries without an explicit user request.
- No \`<iframe>\`, \`<video>\`, \`<audio>\` — PDF export won't capture them.
- No files outside the project directory.
- Do not override design-system tokens for colour or typography.
`;
