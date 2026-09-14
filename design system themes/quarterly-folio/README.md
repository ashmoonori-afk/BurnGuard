# Quarterly Folio Theme

A quarterly-journal system with a warm bone page, a high-contrast didone display, and rules that behave like printed folio marks.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build on these tokens rather than inventing a
grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1080px` | Outer content width |
| `--layout-measure` | `64ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `32px` | Space between columns |
| `--layout-margin` | `clamp(24px, 6vw, 96px)` | Page side margin |
| `--layout-section-y` | `clamp(72px, 9vw, 152px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `5 / 4` | Hero aspect ratio |

Generous outer margins are the defining measurement — the page should feel bound rather than filled. A hairline rule sits above each section heading and runs the full content width, functioning as a folio mark. Images centre within the measure and carry a caption directly beneath.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1 / 1` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `indented` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Media and text take equal tracks when paired, so neither dominates and the spread reads as a balanced opening. Images are contained. Paragraphs are indented with no gap, which is what lets long prose read as a single continuous body.

## Composition

Open every section with a small letterspaced sans eyebrow, then a high-contrast didone display line, then a hairline rule. Body is a warm serif at a comfortable measure with indented paragraphs. The deep green accent is used sparingly — a rule under a live link, a pull quote mark, a section number. Keep margins wide enough that the content looks bound. Never use a card, a shadow or a radius; the only structural devices are the rule, the margin and the indent.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Still life and considered arrangement: objects on a surface, a detail of a material, a composed grouping. Quiet subjects that reward a long look.

**Treatment.** Large-format-feeling photography with fine tonal gradation and a slightly warm cast that sits on bone paper. Matte finish, no digital sharpening halo.

**Light.** Soft directional daylight with a long gentle falloff, as from a tall window. Shadows are present but soft-edged and warm rather than neutral.

**Framing.** Centred and calm, with air above and below so the image can be contained within the measure without crowding its caption.

**Relationship to the palette.** Warm neutrals — bone, clay, oat, faded olive — with at most one deeper note. The image should look at home on the bone page rather than pasted onto it.

**Never:**
- Cool or blue-cast images; they will fight the warm paper.
- Full-bleed treatment — images are contained within the measure.
- High-energy or motion-blurred subjects.
- Any drop shadow or frame added to the image.

**Prompt skeleton.** `large format still life photograph, objects arranged on a warm neutral surface, soft directional window light with long gentle falloff, bone and clay palette, fine tonal gradation, matte finish, centred calm composition`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. Outer margins are wide enough that the page reads as bound rather than filled.
2. Each section opens eyebrow, then didone display, then a hairline rule.
3. Body is a warm serif with indented, ungapped paragraphs.
4. Images are contained within the measure and captioned directly beneath.
5. The green accent appears only as a small mark, never as a filled area.
6. The only structural devices used are rule, margin and indent.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Bodoni Moda; body: Lora; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for eyebrows; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
