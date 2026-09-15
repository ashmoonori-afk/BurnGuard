# Paper Instrument Theme

A bright measured ground built from hairlines and air, where a single ink-blue marks action and nothing else competes.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1240px content maximum, 66ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1240px` | Outer content width |
| `--layout-measure` | `66ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(24px, 5vw, 72px)` | Page side margin |
| `--layout-section-y` | `clamp(72px, 9vw, 144px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `3 / 2` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `mega-feature` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `96px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1200px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `framed-cover` | Opening composition |
| `--layout-hero-copy-ratio` | `80%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `3 / 2` | Opening media aspect ratio |
| `--layout-hero-media-position` | `right` | Opening media placement |
| `--layout-hero-min-height` | `640px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `16ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `24px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `window-stage` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `580px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation is a quiet top row with a hairline beneath it. Labels sit beside their control in a second track, which suits specification-style forms where the label is read as a field name rather than a prompt.

## Composition

Navigation mega-feature → hero framed-cover (80% copy zone, right media, 3 / 2, 640px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep bright paper, generous emptiness and ink-blue actions. Scale, position and full-width hairline rules provide hierarchy; no filled panels or elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single manufactured object or instrument on a plain seamless surface — a measuring tool, a component, a clean product form. One object, centred or on a clear axis.

**Treatment.** Bright, even, near-shadowless product photography. Pure white or bone seamless background that merges with the page ground. Crisp edges, true colour, no texture overlay.

**Light.** Broad soft daylight from the front-top, almost flat, with only the faintest contact shadow to seat the object. No dramatic modelling.

**Framing.** For the website opening, place this theme's source art in the 3 / 2 frame at right specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Achromatic: paper white, light greys, the object's own neutral material. If one accent appears it is the same ink-blue as `--primary-blue`, and only as a small detail.

**Never:**
- Dark or coloured backdrops — the image must merge into the paper ground.
- Hard directional shadows, dramatic contrast, or moody grading.
- Cluttered arrangements, props, hands, or lifestyle staging.
- Gradient meshes or abstract 3D blobs.

**Prompt skeleton.** `product photograph of a single precision instrument on a seamless white background, soft even frontal daylight, minimal contact shadow, generous empty space around the subject, achromatic palette, sharp edges, no props`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep bright paper, generous emptiness and ink-blue actions. Scale, position and full-width hairline rules provide hierarchy; no filled panels or elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Instrument Sans; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `mega-feature` at `top`, with `96px` minimum height and `1200px` width (0px fills the available track). Use top navigation with a 1200px maximum width and 96px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [mega-feature](https://www.navbar.gallery/navbar/chesapeake-plywood). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `framed-cover`: copy share `80%`, media at `right` in a `3 / 2` frame, minimum height `640px`, title measure `16ch`, alignment `start` and desktop offset `24px`. Place a left-aligned statement within an inset paper-like cover and expose the outer field; preserve the instrument-like rule and annotation language. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Retain an inset frame but reduce its padding; stack side cells below the dominant cover so the main image remains usable.

Structural reference: [framed-cover](https://supahero.io/hero/easyfast). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `window-stage` with `3` desktop groups and `580px` minimum height. Reserve 580px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Allow links to wrap and let the closing region grow with content.

Structural reference: [window-stage](https://www.footer.design/sites/the-design-society). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
