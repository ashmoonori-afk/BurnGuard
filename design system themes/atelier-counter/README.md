# Atelier Counter Theme

A bone-paper shop with a didone brand voice, contained product plates, and a purchase panel that stays in the reading flow.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1280px content maximum, 58ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1280px` | Outer content width |
| `--layout-measure` | `58ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 64px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 7vw, 112px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 5` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `profile-popover` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `76px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1320px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `type-marquee` | Opening composition |
| `--layout-hero-copy-ratio` | `84%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 5` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `760px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `10ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `64px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `photo-strip` | Footer arrangement |
| `--layout-footer-columns` | `2` | Desktop footer groups |
| `--layout-footer-height` | `520px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `lead-and-pairs` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `flow` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

The gallery opens with one full-width lead plate and continues in pairs, which gives a product page an opening statement before its detail. Images are contained so the whole object stays visible — in this system the product's silhouette is the selling point. The purchase panel stays in flow so the page reads as a description rather than a conversion funnel.

## Composition

Navigation profile-popover → hero type-marquee (84% copy zone, background media, 4 / 5, 760px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep warm bone paper, didone brand voice, contained product plates and a humanist reading face. Oxblood marks price or action; use hairline rows and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single object presented whole — a garment laid flat, a bag upright, a shoe in profile, an accessory arranged. The complete silhouette must be visible.

**Treatment.** Bright even product photography on a bone or oat seamless that matches the page ground, so the object appears to rest on the paper. Accurate material colour, visible texture, no gloss.

**Light.** Broad soft frontal daylight with a faint contact shadow to seat the object. Almost no modelling; the silhouette matters more than the volume.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Bone and oat surroundings with the product's own colour as the single chroma. Warm cast throughout so it sits on the warm page.

**Never:**
- Cropping the object at the frame edge; the whole silhouette must read.
- Cool grey or white-blue seamless that fights the warm paper.
- Models posing in a scene — this system presents goods, not lifestyle.
- Drop shadows or reflections added in post.

**Prompt skeleton.** `product photograph of a single object presented whole on a bone seamless background, broad soft frontal daylight, faint contact shadow, complete silhouette visible with margin inside the frame, warm accurate material colour, vertical 4:5, no crop, no gloss`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep warm bone paper, didone brand voice, contained product plates and a humanist reading face. Oxblood marks price or action; use hairline rows and no elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Bodoni Moda; body: Figtree; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Scale display lettering within the viewport; keep a static readable ticker and honor reduced motion if any movement is introduced. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `profile-popover` at `top`, with `76px` minimum height and `1320px` width (0px fills the available track). Use top navigation with a 1320px maximum width and 76px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [profile-popover](https://www.navbar.gallery/navbar/hosier-brown). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `type-marquee`: copy share `84%`, media at `background` in a `4 / 5` frame, minimum height `760px`, title measure `10ch`, alignment `start` and desktop offset `64px`. Layer very large display type beside or around a complete contained object; the original object must stay whole even when decorative type reaches the edges. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Mobile: Below the theme's existing compact breakpoint: Scale display lettering within the viewport; keep a static readable ticker and honor reduced motion if any movement is introduced.

Structural reference: [type-marquee](https://supahero.io/hero/red-antler). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `photo-strip` with `2` desktop groups and `520px` minimum height. Reserve 520px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Allow links to wrap and let the closing region grow with content.

Structural reference: [photo-strip](https://www.footer.design/sites/carolyn-lee). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (88px), and `--slide-type-caption` (26px) is the smallest type on any slide.

- Ground: warm bone paper with contained product plates; oxblood marks price or action.
- Cover: a didone marquee with the object plate beneath it.
- Structure: hairline rows and a humanist reading face; nothing elevated. One takeaway per slide, titled at `--slide-type-heading` (60px) with support at `--slide-type-body` (34px).
- Imagery: a single object presented whole, with the complete silhouette visible. At most one image per slide unless the request asks for a grid.
- Never: cropping the object at the frame edge, cool white seamless, models posing in a scene.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.44) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: warm bone paper with contained product plates; oxblood marks price or action.
- Composition: hairline rows and a humanist reading face; nothing elevated. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (136px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (64px), and nothing below `--content-type-caption` (26px) or 12px once scaled.
- Figure: a single object presented whole, with the complete silhouette visible.
- Never: cropping the object at the frame edge, cool white seamless, models posing in a scene.
