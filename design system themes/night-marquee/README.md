# Night Marquee Theme

A title-card system: one cinematic still fills the viewport, a centred stack of small type floats over it, and credits read as label-and-value rows.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1440px content maximum, 46ch reading measure and 16px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1440px` | Outer content width |
| `--layout-measure` | `46ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `16px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 40px)` | Page side margin |
| `--layout-section-y` | `clamp(72px, 10vw, 160px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `side-rail` | Website navigation arrangement |
| `--layout-nav-position` | `side` | Website navigation position |
| `--layout-nav-height` | `72px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `160px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `type-marquee` | Opening composition |
| `--layout-hero-copy-ratio` | `100%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `21 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `700px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `8ch` | Maximum title line measure |
| `--layout-hero-align` | `end` | Hero copy alignment |
| `--layout-hero-offset` | `120px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `window-stage` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `600px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `100%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The display block sits fully over its still — the overlap is total, which is what makes the page a title card rather than a page with a picture on it. Nothing rotates and no line steps: the composition is strictly centred, and the stillness is the effect.

## Composition

Navigation side-rail → hero type-marquee (100% copy zone, below media, 21 / 9, 700px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep the cinematic still, achromatic chrome and small letterspaced credits. Dark space and scale carry the atmosphere, with no raised surfaces. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single human moment held still — a face in half-light, a figure in a doorway, hands at rest. It should read as a frame lifted out of a longer sequence, not as a posed portrait.

**Treatment.** Cinematic capture with visible grain, shallow depth of field, and deep crushed shadows that fall to near-black so the frame merges with the page ground. Colour muted to near-monochrome with one cool cast surviving in the shadows.

**Light.** Low-key and directional — a single practical source, most of the frame in shadow, a narrow highlight describing the subject. No fill. The darkest quarter of the frame should be effectively black.

**Framing.** For the website opening, place this theme's source art in the 21 / 9 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Near-black with a cool teal or indigo cast in the shadows and a single warm practical light. No saturated colour anywhere.

**Never:**
- Bright, evenly lit, or high-key frames — they break the merge with the page.
- Busy compositions with no empty region for the title stack.
- Posed studio portraits or stock-looking smiles.
- Heavy colour grading toward orange and teal clichés.

**Prompt skeleton.** `cinematic film still, single human moment in low-key directional light, most of frame in deep shadow falling to near-black, shallow depth of field, visible grain, near-monochrome with a cool cast in the shadows, subject off-centre leaving empty dark space, 16:9`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the cinematic still, achromatic chrome and small letterspaced credits. Dark space and scale carry the atmosphere, with no raised surfaces.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Scale display lettering within the viewport; keep a static readable ticker and honor reduced motion if any movement is introduced. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `side-rail` at `side`, with `72px` minimum height and `160px` width (0px fills the available track). Use side navigation with a 160px maximum width and 72px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [side-rail](https://www.navbar.gallery/navbar/big-dirty-agency). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `type-marquee`: copy share `100%`, media at `below` in a `21 / 9` frame, minimum height `700px`, title measure `8ch`, alignment `end` and desktop offset `120px`. Use a large empty field and bottom-entering display word as the first fold, with a narrow side rail and a separate window-stage closing rhythm. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Scale display lettering within the viewport; keep a static readable ticker and honor reduced motion if any movement is introduced. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells.

Structural reference: [type-marquee](https://supahero.io/hero/exat). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `window-stage` with `3` desktop groups and `600px` minimum height. Reserve 600px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Allow links to wrap and let the closing region grow with content.

Structural reference: [window-stage](https://www.footer.design/sites/the-design-society). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (104px), and `--slide-type-caption` (26px) is the smallest type on any slide.

- Ground: one cinematic still with achromatic chrome; small letterspaced credits are the only chrome allowed.
- Cover: a title stack placed in the empty region of the held frame.
- Structure: dark space and scale carry the atmosphere; no raised surfaces anywhere. One takeaway per slide, titled at `--slide-type-heading` (60px) with support at `--slide-type-body` (34px).
- Imagery: a single human moment held still, lifted out of a longer sequence. At most one image per slide unless the request asks for a grid.
- Never: bright high-key frames, frames with no empty region for the title, posed studio smiles.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (10% of the shorter side), place the primary figure at `--content-figure` (0.36) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: one cinematic still with achromatic chrome; small letterspaced credits are the only chrome allowed.
- Composition: dark space and scale carry the atmosphere; no raised surfaces anywhere. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (144px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (68px), and nothing below `--content-type-caption` (26px) or 12px once scaled.
- Figure: a single human moment held still, lifted out of a longer sequence.
- Never: bright high-key frames, frames with no empty region for the title, posed studio smiles.
