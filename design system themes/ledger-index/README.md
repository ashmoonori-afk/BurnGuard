# Ledger Index Theme

A hairline-ruled index: boxed cells, all-caps micro type, monochrome imagery, no radius and no shadow.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build every artifact on these tokens rather than inventing a grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1400px | Outer content width |
| `--layout-measure` | 48ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 0px | Space between columns |
| `--layout-margin` | 24px | Page side margin |
| `--layout-section-y` | 0px | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 800px / 1180px | Breakpoints |
| `--layout-hero` | 1 / 1 | Hero aspect ratio |

Everything is a ruled cell. Columns touch with zero gutter and share 1px borders that meet exactly, so the page reads as one table. Sections do not use vertical spacing - the rule between rows is the separation.

## Composition

The page is a ruled index. Every item lives in a boxed cell bounded by hairlines, and the boxes share edges so the sheet reads as one continuous ruling rather than as separate cards. Type is small and all-caps for labels, with a short 48ch measure for any running text — this system is built for scanning, not reading. Imagery is monochrome so it never outweighs the ruling. There is no radius and no shadow anywhere; a raised surface would contradict the sheet. Emphasis is achieved by cell size and rule weight, never by colour fill.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An indexed item shown plainly — an artefact, a document, a building, a specimen. It identifies an entry rather than illustrating a story.

**Treatment.** Converted to monochrome with a full but gentle tonal range, so a page of them reads as one consistent set. No colour survives.

**Light.** Even and documentary. Contrast should be moderate; crushed blacks or blown highlights break the uniformity of the sheet.

**Framing.** Fills its cell exactly, cropped to the cell's aspect rather than the subject's. Consistency across cells matters more than any single crop.

**Relationship to the palette.** Monochrome only, on the paper ground. The interface supplies no colour to compete with.

**Never:**
- Colour images of any kind.
- Inconsistent tonal treatment between cells.
- Drop shadows, rounded corners, or borders baked into the file.
- Dramatic contrast that makes one cell dominate the sheet.

**Prompt skeleton.** `monochrome documentary photograph of a single indexed item, even documentary lighting, moderate contrast with a full gentle tonal range, cropped to fill the frame, consistent treatment, no colour, no shadow effects`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the
design. Check the result against all of these:

1. Every item sits in a hairline-bounded cell and the cells share edges.
2. Labels are small all-caps; running text holds to a 48ch measure.
3. All imagery is monochrome.
4. There is no radius and no shadow anywhere on the page.
5. Emphasis comes from cell size and rule weight, never from a colour fill.
6. The sheet reads as one continuous ruling rather than as separate cards.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for all UI text, "Nanum Myeongjo" for serif; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
