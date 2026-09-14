# Signal Reel Theme

Near-black ground, one signal red, and an oversized grotesque that runs past the frame.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build every artifact on these tokens rather than inventing a grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | none | Outer content width |
| `--layout-measure` | 52ch | Reading measure for body copy |
| `--layout-columns` | 6 | Base column count |
| `--layout-gutter` | 0px | Space between columns |
| `--layout-margin` | clamp(16px, 3vw, 40px) | Page side margin |
| `--layout-section-y` | clamp(28px, 4vw, 64px) | Vertical rhythm between sections |
| `--layout-rule` | 0px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 720px / 1080px | Breakpoints |
| `--layout-hero` | 21 / 9 | Hero aspect ratio |

Media is full-bleed with no container and no gutter, and sections butt directly against each other. Text blocks keep a small margin and section rhythm so a tight-leading display line never crops against the viewport edge. Type is positioned over the media, and the display line is allowed to crop at the viewport edge.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Anton; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Black Han Sans" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
