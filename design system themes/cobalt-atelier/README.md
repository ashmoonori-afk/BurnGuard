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

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang", "Pretendard" for serif headings, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
