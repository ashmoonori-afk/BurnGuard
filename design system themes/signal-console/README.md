# Signal Console Theme

A near-black instrument ground where one phosphor signal marks everything live, and mono chrome annotates rather than decorates.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1320px content maximum, 62ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1320px` | Outer content width |
| `--layout-measure` | `62ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(20px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 7vw, 112px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 10` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `icon-taxonomy` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `92px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1380px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `product-panel` | Opening composition |
| `--layout-hero-copy-ratio` | `50%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 10` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `600px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `19ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `retail-accordion` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `440px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation is a single top row at `--layout-nav-h`; the span value is inert here and exists so a side-navigation variant stays expressible. Labels stack above their control so a dense form keeps one reading column.

## Composition

Navigation icon-taxonomy → hero product-panel (50% copy zone, below media, 16 / 10, 600px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep near-black with phosphor reserved for live states. Mono labels and numbered annotations support a real product surface; use hairline regions, no shadows and radii at or below 3px. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Hardware and interface: a rack, a board, a device edge, or a close macro of a connector, shot as an object rather than a scene. No people, no desks, no offices.

**Treatment.** Photographic, high fidelity, matte surfaces, deep blacks that stay black. Fine machined detail preserved. No gloss, no lens flare, no bokeh-heavy blur.

**Light.** Single cool key from one side against a very dark field, with controlled falloff. Small phosphor-green emissive points may appear as status indicators and are the only saturated colour in frame.

**Framing.** For the website opening, place this theme's source art in the 16 / 10 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Near-black ground with cool grey mid-tones; the only chroma is the phosphor green of indicator lights, matching `--primary-blue`. Treat any other hue as a defect.

**Never:**
- Stock-photo people, handshakes, or open-plan offices.
- Blue-glow 'cyber' gradients, circuit-board overlays, or holographic UI clichés.
- Warm ambient light or amber practicals — they break the single-signal rule.
- Visible brand marks or readable third-party logos.

**Prompt skeleton.** `macro photograph of matte-black server hardware, single cool key light from the left, deep black background, small green status LEDs, fine machined detail, no people, no logos, tight frontal crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep near-black with phosphor reserved for live states. Mono labels and numbered annotations support a real product surface; use hairline regions, no shadows and radii at or below 3px.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Geist; body: Geist; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Keep title, actions and interface panel in document order; allow the panel to scale proportionally rather than forcing desktop width. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `icon-taxonomy` at `top`, with `92px` minimum height and `1380px` width (0px fills the available track). Use top navigation with a 1380px maximum width and 92px header height. At compact widths, use product/use-case/enterprise disclosure rows. Use single-column disclosures; keep the promotional card secondary.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [icon-taxonomy](https://www.navbar.gallery/navbar/velt). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `product-panel`: copy share `50%`, media at `below` in a `16 / 10` frame, minimum height `600px`, title measure `19ch`, alignment `start` and desktop offset `0px`. Use a shallow introduction/action row above a wide interface panel; reserve navigation taxonomy for compact categorized groups. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Keep title, actions and interface panel in document order; allow the panel to scale proportionally rather than forcing desktop width.

Structural reference: [product-panel](https://supahero.io/hero/modify). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `retail-accordion` with `4` desktop groups and `440px` minimum height. Reserve 440px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Mobile replaces the three link columns with three ruled rows showing plus disclosure marks; locale/legal is centered beneath, above the cropped wordmark. Allow links to wrap and let the closing region grow with content.

Structural reference: [retail-accordion](https://www.footer.design/sites/outway). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (72px), and `--slide-type-caption` (24px) is the smallest type on any slide.

- Ground: the near-black instrument ground; phosphor marks only a live or interactive state.
- Cover: a real product surface panel in the upper band with the title beneath it.
- Structure: mono labels and numbered annotation, hairline regions, radii at or below 3px. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: hardware or an interface shot as an object, never a desk or an office. At most one image per slide unless the request asks for a grid.
- Never: stock-photo people, cyber gradients or circuit overlays, warm ambient light.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.61) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the near-black instrument ground; phosphor marks only a live or interactive state.
- Composition: mono labels and numbered annotation, hairline regions, radii at or below 3px. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (116px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: hardware or an interface shot as an object, never a desk or an office.
- Never: stock-photo people, cyber gradients or circuit overlays, warm ambient light.
