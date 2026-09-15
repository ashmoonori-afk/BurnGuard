# Stencil Field Theme

A studio system built on emptiness: a vast pale field, one enormous display statement, and a saturated full-bleed media band the statement dips into.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1600px content maximum, 60ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1600px` | Outer content width |
| `--layout-measure` | `60ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(16px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(96px, 14vw, 224px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `21 / 9` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `segmented-pill` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `80px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1120px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `masthead-crop` | Opening composition |
| `--layout-hero-copy-ratio` | `90%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `16 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `680px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `10ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `64px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `ruled-community` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `440px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `24%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The display block translates up by roughly a quarter of its own height, so its first line crosses back over the media band it follows. That single overlap is the whole trick of the system: type and image are one object at exactly one seam, and everywhere else they stay apart.

## Composition

Navigation segmented-pill → hero masthead-crop (90% copy zone, background media, 16 / 9, 680px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep the spacious field, saturated media and wide display face. Green marks links or live states only; thin rules and a single deliberate image/type seam carry the structure. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An abstract material close-up — poured pigment, blown glass, folded metal, dyed textile. No identifiable object, no person, no place. The image is a colour event.

**Treatment.** Macro or near-macro photography with the material filling the entire frame, saturated to the edge of plausible but still physical. Surfaces glossy or wet so light travels through them.

**Light.** Bright, wrapping, high-key light with specular highlights. The material should look self-luminous rather than lit from one side.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** One dominant saturated hue occupying most of the frame, with its own highlights and shadows as the only variation. Different sections may use different hues, but never two competing hues in one frame.

**Never:**
- Recognisable objects, people, logos, or places.
- Muted, dusty, or pastel treatments — the band must be loud against the pale field.
- Multiple competing hues in a single frame.
- Narrow crops with a clear subject; this is a band, not a picture.

**Prompt skeleton.** `ultra-wide macro photograph of an abstract glossy material surface filling the frame, single dominant saturated hue, bright wrapping high-key light with specular highlights, wet luminous texture, no recognisable object, 21:9 band crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the spacious field, saturated media and wide display face. Green marks links or live states only; thin rules and a single deliberate image/type seam carry the structure.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Syne; body: Space Grotesk; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Reduce the oversized display to fit the viewport; move useful metadata into normal flow and keep the subject recognizable. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `segmented-pill` at `top`, with `80px` minimum height and `1120px` width (0px fills the available track). Use top navigation with a 1120px maximum width and 80px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [segmented-pill](https://www.navbar.gallery/navbar/consensys). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `masthead-crop`: copy share `90%`, media at `background` in a `16 / 9` frame, minimum height `680px`, title measure `10ch`, alignment `center` and desktop offset `64px`. Retain a hard seam from a dominant media band to the statement; the portrait-centered reference informs scale, not permission to erase the seam. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Reduce the oversized display to fit the viewport; move useful metadata into normal flow and keep the subject recognizable.

Structural reference: [masthead-crop](https://supahero.io/hero/lando-norris). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `ruled-community` with `3` desktop groups and `440px` minimum height. Reserve 440px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [ruled-community](https://www.footer.design/sites/harvest-hall). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Reference adaptation: 199 - Figma CONFIG2025 Conference Deck (pp. 1, 2, 3, 4, 7, 10, 12). Layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Oversized left-aligned type in 8/12; cropped geometric forms occupy the opposite corner or bottom band.

- Body: Speaker/event content uses one horizontal portrait band with aligned labels. Alternate black, light and brand-accent chapter grounds.

- Evidence: Use a 7/5 split: three short statements left, a large example above a caption block right; geometric bands establish hierarchy.

- Closing: One oversized takeaway and one cropped geometric block; never repeat the speaker grid as a default body layout.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.41) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: the spacious pale field with saturated media; green marks links or live states only.
- Composition: thin rules and a single deliberate image-to-type seam. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (136px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (64px), and nothing below `--content-type-caption` (26px) or 12px once scaled.
- Figure: an abstract material close-up; the image is a colour event, not an object.
- Never: recognisable objects or people, muted pastel treatments, competing hues in one frame.
