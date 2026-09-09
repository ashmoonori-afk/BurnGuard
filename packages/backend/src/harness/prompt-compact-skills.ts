export const COMPACT_DECK_SKILL_MD = `# Slide deck compact contract

## Token budget rules (READ THESE FIRST)
- The "## Deck structure" section above is your map. Use it to plan instead of Reading the full file.
- **Read \`deck.html\` at most ONCE per turn.** Re-reading the same file is forbidden — keep findings in working memory across tool calls.
- When you do need a slide's exact markup, use \`Grep\` for \`data-bg-node-id="slide-N"\` to find the line, then \`Read\` with \`offset\`/\`limit\` covering that slide only — never the whole file.
- Prefer multiple targeted \`Edit\` calls (small \`old_string\`/\`new_string\`) over a \`Write\` of the whole file. \`Write\` re-emits the entire 100 KB+ artifact and is the most expensive thing you can do.
- For multi-slide redesigns, plan all edits before executing, then issue them as a batch. Do not Read between Edits.

## Structure
- Every slide is a top-level \`<section data-slide>\` directly under \`<body>\`. Preserve order unless the user asks for narrative change.
- Preserve \`<script src="/runtime/deck-stage.js" defer></script>\`; do not set \`data-active\` statically or reimplement deck navigation.
- Every visible text element needs a unique \`data-bg-node-id="slide-{N}-{purpose}"\`; parent slides use \`data-bg-node-id="slide-{N}"\`.

## Style
- Use asymmetric layouts, oversized type or KPI numbers where useful, and avoid centered-everything except cover/closing slides.
- Keep CSS inline in the top \`<style>\` block. Reference design-system CSS variables (see list above) and avoid new palettes, font stacks, or typefaces.`;

export const COMPACT_PROTOTYPE_SKILL_MD = `# Prototype compact contract

## Token budget rules (READ THESE FIRST)
- The "## Prototype structure" section above is your map. Use it to plan instead of Reading the full file.
- Read each target HTML file at most once per turn; keep findings in working memory across tool calls.
- When you need a section's exact markup, use \`Grep\` for \`data-section="..."\` (or \`data-bg-node-id\`) to find the line, then \`Read\` with \`offset\`/\`limit\` covering that section only.
- Prefer multiple targeted \`Edit\` calls over \`Write\`. \`Write\` re-emits the entire artifact and is the most expensive thing you can do.

## Structure & style
- Keep \`index.html\` as home; each HTML page uses inline CSS and vanilla JS unless the user explicitly asks otherwise.
- Top-level semantic sections need \`data-section\` and unique \`data-bg-node-id\` values for visible text and editable parent sections.
- Strong visual hierarchy, asymmetric sections outside true heroes, responsive down to 360 px, no hidden primary value.
- Keep CSS in one top \`<style>\` block. Reference design-system CSS variables (see list above) and avoid new palettes, font stacks, or typefaces.`;
