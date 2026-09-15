# Blueprint Manual Theme

A technical reference manual: paper ground, blueprint line work, justified serif body, and mono figure labels.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1320px content maximum, 66ch reading measure and 16px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | 1320px | Outer content width |
| `--layout-measure` | 66ch | Reading measure for body copy |
| `--layout-columns` | 12 | Base column count |
| `--layout-gutter` | 16px | Space between columns |
| `--layout-margin` | clamp(16px, 3vw, 40px) | Page side margin |
| `--layout-section-y` | clamp(40px, 5vw, 72px) | Vertical rhythm between sections |
| `--layout-rule` | 1px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 860px / 1200px | Breakpoints |
| `--layout-hero` | 3 / 2 | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `enterprise-columns` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `104px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1440px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `specimen-poster` | Opening composition |
| `--layout-hero-copy-ratio` | `92%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `720px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `12ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `36px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `contact-ledger` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `560px` | Footer minimum height; content may grow |

## Composition

Navigation enterprise-columns → hero specimen-poster (92% copy zone, background media, 4 / 3, 720px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep the paper ground, blueprint annotations, numbered figures, serif reading body and mono headings. Line work explains content; use near-square corners and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A described object — a component, an assembly, a tool, a mechanism — shown as a figure that the surrounding text refers to.

**Treatment.** Either a clean orthographic line drawing or a flat record photograph on paper-white, in both cases free of styling. The image exists to be annotated.

**Light.** Even and shadowless. A manual figure has no atmosphere; any shadow that is not describing form is noise.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Paper-white with graphite line weight and the blueprint blue for annotation. No other colour appears.

**Never:**
- Atmospheric or styled photography; this is a figure, not a picture.
- Coloured or gradient backgrounds.
- Annotation baked into the image; labels are typeset, not drawn in.
- Crops that leave no margin for leader lines.

**Prompt skeleton.** `clean orthographic technical figure of a mechanical component on paper-white, even shadowless lighting, graphite line weight, contained with clear margin around the object, no styling, no colour, no annotation in the image`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the paper ground, blueprint annotations, numbered figures, serif reading body and mono headings. Line work explains content; use near-square corners and no elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: JetBrains Mono; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif body, "Pretendard" for UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `enterprise-columns` at `top`, with `104px` minimum height and `1440px` width (0px fills the available track). Use top navigation with a 1440px maximum width and 104px header height. At compact widths, use category rows with chevrons under a compact brand/close bar. Collapse taxonomy columns into grouped disclosures.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [enterprise-columns](https://www.navbar.gallery/navbar/cloudflare). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `specimen-poster`: copy share `92%`, media at `background` in a `4 / 3` frame, minimum height `720px`, title measure `12ch`, alignment `start` and desktop offset `36px`. Keep the technical specimen legible and dominant below an edge-wide title; metadata should remain small groups, never a second competing card grid. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll.

Structural reference: [specimen-poster](https://supahero.io/hero/35mm). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `contact-ledger` with `3` desktop groups and `560px` minimum height. Reserve 560px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Mobile keeps small brand/company metadata in two columns, expands the signup rule across the width, stacks contact addresses, and shifts the large wordmark to the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [contact-ledger](https://www.footer.design/sites/esr). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
