# Daylight Press Theme

Warm off-white paper, one buttercup accent, soft lowercase display, and fully rounded actions.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build every artifact on these tokens rather than inventing a grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1080px | Outer content width |
| `--layout-measure` | 62ch | Reading measure for body copy |
| `--layout-columns` | 8 | Base column count |
| `--layout-gutter` | 32px | Space between columns |
| `--layout-margin` | clamp(24px, 6vw, 72px) | Page side margin |
| `--layout-section-y` | clamp(72px, 10vw, 160px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 768px / 1024px | Breakpoints |
| `--layout-hero` | 4 / 3 | Hero aspect ratio |

Generous single-column flow with wide side margins; two-up image pairs at most. Vertical rhythm is deliberately large so the page breathes, and the primary action sits alone on its own line.

## Composition

Set everything on warm off-white paper with one buttercup accent reserved for the primary action and the active state. The display face is soft and lowercase — no uppercase display line exists in this system — and it sits at a friendly rather than a monumental scale. Body copy runs to a comfortable 62ch measure with generous leading. Actions are fully rounded pills, which is the only place roundness appears at that strength; cards and images take a smaller radius. Dividers are hairlines in a warm grey. The page should read as approachable and printed rather than engineered.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Everyday life at close range — hands at work, a table, a walk, an ordinary object in use. Warm and unremarkable by design.

**Treatment.** Natural photography with warm colour, gentle contrast, and film-like softness. Nothing clinical, nothing dramatic.

**Light.** Soft diffused daylight, slightly overexposed toward the highlights so the frame sits comfortably on the warm paper.

**Framing.** Landscape or square with the subject close and a relaxed composition. Small radius applied at display time, never baked into the file.

**Relationship to the palette.** Warm off-white, buttercup, straw and soft neutrals. Any strong colour in frame should be warm.

**Never:**
- Cool or blue-grey grading; it turns the paper grey.
- Hard shadows, heavy contrast, or dramatic light.
- Corporate or stock-looking staged scenes.
- Baked-in rounded corners or borders in the image file.

**Prompt skeleton.** `natural photograph of an everyday close-range moment, soft diffused daylight lifted toward the highlights, warm gentle contrast, film-like softness, relaxed composition, warm straw and off-white palette, no drama`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. The ground is warm off-white and buttercup appears only on the primary action and active state.
2. The display face is lowercase throughout; no uppercase display line exists.
3. Body copy runs to a 62ch measure with generous leading.
4. Actions are fully rounded pills; cards and images take a smaller radius.
5. Dividers are hairlines in warm grey.
6. Imagery is warm, soft and lifted toward the highlights.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Outfit; body: DM Sans; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
