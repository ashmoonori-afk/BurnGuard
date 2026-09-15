# Cobalt Atelier Theme

A saturated cobalt field carrying a light serif display, mono micro-labels, and hard-edged interactive blocks.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1240px content maximum, 58ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

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
| `--layout-hero` | 16 / 9 | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `profile-popover` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `72px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1260px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-left` | Opening composition |
| `--layout-hero-copy-ratio` | `42%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `right` | Opening media placement |
| `--layout-hero-min-height` | `640px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `9ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `studio-address` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `560px` | Footer minimum height; content may grow |

## Composition

Navigation profile-popover → hero split-left (42% copy zone, right media, 4 / 3, 640px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Cobalt is the ground, not an accent. Keep the light serif voice, mono labels, near-square unraised controls and visible cobalt around inset imagery. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single subject isolated against a plain ground — an object, a figure, a material study. One idea per frame, no scene.

**Treatment.** High-contrast photography with the subject cleanly separated from its background, so it can be inset into a saturated field without the two fighting. Cool colour bias throughout.

**Light.** Directional light with a firm shadow edge. Contrast is high, midtones are few, and the result reads graphic rather than atmospheric.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Cool neutrals and steel tones so the image sits inside the cobalt field rather than clashing with it. Warm subjects must be graded cool.

**Never:**
- Warm golden or amber grading; it fights the field.
- Busy backgrounds that break the inset border's rhythm.
- Soft, low-contrast, or hazy treatments.
- Removing the cobalt field from body inset figures; the website opening follows its named Hero arrangement.

**Prompt skeleton.** `high-contrast photograph of a single isolated subject on a plain cool ground, directional light with a firm shadow edge, cool steel colour bias, subject centred with even margin, graphic rather than atmospheric, portrait crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Cobalt is the ground, not an accent. Keep the light serif voice, mono labels, near-square unraised controls and visible cobalt around inset imagery.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang", "Pretendard" for serif headings, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `profile-popover` at `top`, with `72px` minimum height and `1260px` width (0px fills the available track). Use top navigation with a 1260px maximum width and 72px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [profile-popover](https://www.navbar.gallery/navbar/hosier-brown). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-left`: copy share `42%`, media at `right` in a `4 / 3` frame, minimum height `640px`, title measure `9ch`, alignment `start` and desktop offset `0px`. Use a short stacked display at left, a large isolated figure at right and a low horizontal selection strip; preserve the original cobalt emphasis. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Stack the copy above the image; retain a visible text/image boundary and allow actions to wrap.

Structural reference: [split-left](https://supahero.io/hero/anubi). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `studio-address` with `4` desktop groups and `560px` minimum height. Reserve 560px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Allow links to wrap and let the closing region grow with content.

Structural reference: [studio-address](https://www.footer.design/sites/reality-is). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
