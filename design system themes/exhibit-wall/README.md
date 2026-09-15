# Exhibit Wall Theme

A gallery system: warm plaster ground, works hung whole with air around them, and wall-label metadata in stepped display lines.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1340px content maximum, 62ch reading measure and 32px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1340px` | Outer content width |
| `--layout-measure` | `62ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `32px` | Space between columns |
| `--layout-margin` | `clamp(20px, 5vw, 72px)` | Page side margin |
| `--layout-section-y` | `clamp(64px, 9vw, 144px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `3 / 2` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `profile-popover` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `72px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1300px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `portfolio-peek` | Opening composition |
| `--layout-hero-copy-ratio` | `46%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 5` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `680px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `15ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `72px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `centered-cta` | Footer arrangement |
| `--layout-footer-columns` | `1` | Desktop footer groups |
| `--layout-footer-height` | `400px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `3ch` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `0%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

Display lines step three characters further along the inline axis on each successive line, producing a staircase that reads as a hand-set wall text. Nothing rotates and nothing overlaps imagery: in this system the work is never touched by type.

## Composition

Navigation profile-popover → hero portfolio-peek (46% copy zone, below media, 4 / 5, 680px minimum) → retain the existing theme-specific body hierarchy → footer centered-cta.

Keep warm plaster visible around complete works. Serif wall text and mono labels provide title, year, medium and dimensions; clay marks action, with zero radius and elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single artwork or made object photographed as documentation — a painting, a sculpture, a ceramic, a textile piece. One work per frame, always complete.

**Treatment.** Gallery documentation photography: the work shown whole and square to the lens, on or against a warm off-white plaster wall that matches the page ground. Faithful colour, visible surface texture, no styling.

**Light.** Even diffused gallery light with a soft falloff toward the frame edges and a faint shadow where the work meets the wall. No spotlights, no hotspots.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm off-white plaster surroundings with the work's own colours as the only chroma. Neutral to warm cast throughout; never cool or blue-white.

**Never:**
- Cropping into the work or bleeding it to the frame edge.
- Cool white or grey gallery walls that clash with the warm ground.
- Visitors, hands, plinth clutter, or reflections of a room.
- Dramatic spotlighting or heavy vignetting.

**Prompt skeleton.** `gallery documentation photograph of a single artwork hung on a warm off-white plaster wall, shown whole and square to the lens with clear wall margin on all sides, even diffused gallery light, faint contact shadow, faithful colour and visible surface texture, landscape 3:2, no people, no crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep warm plaster visible around complete works. Serif wall text and mono labels provide title, year, medium and dimensions; clay marks action, with zero radius and elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Fraunces; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile retains the same central axis and horizontal social row, reducing the bottom wordmark height. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `profile-popover` at `top`, with `72px` minimum height and `1300px` width (0px fills the available track). Use top navigation with a 1300px maximum width and 72px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [profile-popover](https://www.navbar.gallery/navbar/hosier-brown). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `portfolio-peek`: copy share `46%`, media at `below` in a `4 / 5` frame, minimum height `680px`, title measure `15ch`, alignment `start` and desktop offset `72px`. Stage one complete work with neighboring preview windows; preserve the full artwork and use a small closing action rather than dense links. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Mobile: Below the theme's existing compact breakpoint: Convert scattered or overlapping panels into a deliberate ordered list; preserve one dominant work and smaller supporting items.

Structural reference: [portfolio-peek](https://supahero.io/hero/gallereee). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `centered-cta` with `1` desktop groups and `400px` minimum height. Reserve 400px as the desktop minimum closing height with one information group. Use a conversion-focused footer with one primary action and a small secondary link row. Keep decorative wordmarks separate from accessible link labels.

Mobile retains the same central axis and horizontal social row, reducing the bottom wordmark height. Allow links to wrap and let the closing region grow with content.

Structural reference: [centered-cta](https://www.footer.design/sites/cronicle). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
