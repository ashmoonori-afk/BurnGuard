# Warm Vestibule Theme

A place system: a full-bleed interior supplies the palette, then a calm white band carries one grotesque statement and plain visiting columns.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1360px content maximum, 56ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1360px` | Outer content width |
| `--layout-measure` | `56ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 56px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 8vw, 128px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `floating-island` | Website navigation arrangement |
| `--layout-nav-position` | `overlay` | Website navigation position |
| `--layout-nav-height` | `72px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `840px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `fullbleed-top` | Opening composition |
| `--layout-hero-copy-ratio` | `62%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `760px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `19ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `32px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `scenic-overlay` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `600px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.6` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `100%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery covers its frame and bleeds the full 100% to the viewport edge, because a room has no margin. In side-by-side sections the media track is 1.6 times the text track: the place leads and the writing accompanies it.

## Composition

Navigation floating-island → hero fullbleed-top (62% copy zone, background media, 16 / 9, 760px minimum) → retain the existing theme-specific body hierarchy → footer scenic-overlay.

Keep putty, timber, clay and olive from the interior, plain practical lists and unraised square surfaces. The place leads; no cart, price or promotional offer. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An interior or an architectural space with no people in it — a room, a corridor, a courtyard, a corner with furniture and light. The space is the subject.

**Treatment.** Natural architectural photography with true verticals, warm neutral colour, and visible material texture: timber grain, brick, plaster, textile, worn floor. Unstyled and lived-in rather than staged.

**Light.** Daylight from a window or an opening, warm and directional, with soft shadows describing depth. Time of day should read as late morning or afternoon.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Putty, timber, clay, charcoal and olive drawn from the real materials in frame. The interface palette is taken from the photograph, so the photograph must be warm and neutral.

**Never:**
- People in frame; this system shows places, not occupants.
- Cool blue-white or fluorescent colour casts that fight the warm ground.
- Tilted verticals or wide-angle distortion.
- Over-styled staging — a magazine set with props arranged for the camera.

**Prompt skeleton.** `architectural interior photograph of an empty lived-in room, warm directional daylight from a window, true straight verticals, visible timber brick and plaster texture, warm neutral colour, clear depth cue through a doorway, wide 16:9, no people, no staging`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep putty, timber, clay and olive from the interior, plain practical lists and unraised square surfaces. The place leads; no cart, price or promotional offer.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile gives the scene its own tall area above a dark information region. Navigation becomes a two-column grid; a row of three small marks and the tagline follow. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `floating-island` at `overlay`, with `72px` minimum height and `840px` width (0px fills the available track). Use overlay navigation with a 840px maximum width and 72px header height. At compact widths, use an expanded dark vertical menu with brand and close control. Preserve compact header and expand links vertically.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [floating-island](https://www.navbar.gallery/navbar/supaste). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `fullbleed-top`: copy share `62%`, media at `background` in a `16 / 9` frame, minimum height `760px`, title measure `19ch`, alignment `start` and desktop offset `32px`. Give the existing warm room photograph the full first fold, placing the introduction near the upper-left with readable ground-backed text. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow.

Structural reference: [fullbleed-top](https://supahero.io/hero/integratedbio). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `scenic-overlay` with `3` desktop groups and `600px` minimum height. Reserve 600px as the desktop minimum closing height with 3 information columns or groups. Reserve a scenic field above a readable information zone on narrow screens. Use an original local background; do not depend on WebGL or video for access to navigation.

Mobile gives the scene its own tall area above a dark information region. Navigation becomes a two-column grid; a row of three small marks and the tagline follow. Allow links to wrap and let the closing region grow with content.

Structural reference: [scenic-overlay](https://www.footer.design/sites/eclipse-space). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 085 - Ace & Tate Responsibility Report 2020 (pp. 1, 2, 3, 4, 13, 25, 37, 49). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Large editorial title crosses a soft organic brand-colour field, leaving a clear reading zone.

- Body: Organic chapter shape occupies left 6/12; concise narrative in right 6/12. Alternate large quotations and restrained report pages.

- Evidence: Place one impact number in a clear negative-space island, with explanations in a separate column; never distort a chart with decorative blobs.

- Closing: Repeat the organic field with one brief commitment and a quiet signature; preserve the theme's own type families.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.55) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: putty, timber, clay and olive taken from the interior; the place leads; no cart, price or promotional device appears.
- Composition: plain practical lists on unraised square surfaces. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: an interior or architectural space with no people in it.
- Never: people in frame, cool fluorescent casts, tilted verticals or wide-angle distortion.
