# Cobalt Atelier Theme

A saturated cobalt field carrying a light serif display, mono micro-labels, and hard-edged interactive blocks.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build every artifact on these tokens rather than inventing a grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1240px | Outer content width |
| `--layout-measure` | 58ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 24px | Space between columns |
| `--layout-margin` | clamp(20px, 4vw, 64px) | Page side margin |
| `--layout-section-y` | clamp(64px, 9vw, 140px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 760px / 1120px | Breakpoints |
| `--layout-hero` | 16 / 9 | Hero aspect ratio |

Hold a single wide column for the headline and let supporting blocks occupy 5 of the 12 columns, offset rather than centred. Hairline rules at --layout-rule mark section boundaries; never box a section in a card.

## Composition

Flood the page with the cobalt field and let it carry the whole composition — it is the ground, not an accent, and no second large colour is introduced. A light serif display sits directly on the field at generous size with tight leading, and body copy holds to a 58ch measure so the field stays visible around it. Every label, caption and figure mark is mono, small, and uppercase, which is the only texture the page gets. Interactive elements are near-square blocks — the small `--r-*` steps, never a pill — and carry no shadow, so they read as cut apertures in the field rather than as raised controls. Imagery is inset into the field with a visible border of cobalt on all sides.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single subject isolated against a plain ground — an object, a figure, a material study. One idea per frame, no scene.

**Treatment.** High-contrast photography with the subject cleanly separated from its background, so it can be inset into a saturated field without the two fighting. Cool colour bias throughout.

**Light.** Directional light with a firm shadow edge. Contrast is high, midtones are few, and the result reads graphic rather than atmospheric.

**Framing.** Portrait or square, subject centred with even margin, so the surrounding cobalt border stays equal on all sides.

**Relationship to the palette.** Cool neutrals and steel tones so the image sits inside the cobalt field rather than clashing with it. Warm subjects must be graded cool.

**Never:**
- Warm golden or amber grading; it fights the field.
- Busy backgrounds that break the inset border's rhythm.
- Soft, low-contrast, or hazy treatments.
- Bleeding the image to the viewport edge; the field must surround it.

**Prompt skeleton.** `high-contrast photograph of a single isolated subject on a plain cool ground, directional light with a firm shadow edge, cool steel colour bias, subject centred with even margin, graphic rather than atmospheric, portrait crop`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. The cobalt field is the page ground, not an accent, and no second large colour appears.
2. A light serif display sits directly on the field at generous size with tight leading.
3. All labels and captions are small uppercase mono.
4. Interactive elements are near-square blocks at the small `--r-*` steps, never pills, and none is elevated.
5. Images are inset with an equal cobalt border on all sides and never bleed.
6. Body copy holds to a 58ch measure so the field stays visible around it.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang", "Pretendard" for serif headings, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
