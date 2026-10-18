# Exploded Field Module Theme

An anodized-stone field-hardware and repairable-electronics system: numbered module breakdowns, dense all-caps capability matrices, component-level upgrade tables, and one signal-vermilion callout.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1380px content maximum, 62ch reading measure and 20px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1380px` | Outer content width |
| `--layout-measure` | `62ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(20px, 3.5vw, 56px)` | Page side margin |
| `--layout-section-y` | `clamp(48px, 6vw, 96px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 3` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `icon-taxonomy` | Website navigation arrangement |
| `--layout-nav-position` | `top` | Website navigation position |
| `--layout-nav-height` | `76px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `1320px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `specimen-poster` | Opening composition |
| `--layout-hero-copy-ratio` | `42%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 3` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `700px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `14ch` | Maximum title line measure |
| `--layout-hero-align` | `start` | Hero copy alignment |
| `--layout-hero-offset` | `40px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `studio-address` | Footer arrangement |
| `--layout-footer-columns` | `4` | Desktop footer groups |
| `--layout-footer-height` | `520px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation stays in a top strip with a 1px rule below so full-width module grids and repairability tables are never squeezed. Labels sit beside their controls in a two-track specification layout so capacity chips, port modules, and firmware options read like an engineering bill of materials.

## Composition

Navigation icon-taxonomy → hero specimen-poster (42% copy zone, background media, 4 / 3, 700px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Structure hardware detail pages as a field manual and teardown: open with the complete device specimen and model revision badge, follow with a dense all-caps capability wall (numbered 01–24 or 01–100), break the product into numbered hardware module sections (display assembly, signal engine, battery bay, expansion ports, tactile rotary controls), include a component-by-component repairability and upgrade specification table, and close with a 6-column compatible accessory grid. Signal vermilion (`--primary-blue`) marks the active rotary control, revision badge, or buy action; anodized stone and carbon ink carry everything else.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Precision portable audio/compute hardware or modular electronics: a CNC-machined anodized aluminum chassis, exposed fastener heads, color-coded rotary encoders, or a flat-lay exploded teardown of internal modules on a stone mat.

**Treatment.** Crisp overhead or three-quarter macro product photography on a matte warm-stone ground matching `--bg`. High micro-contrast on knurled metal, legends, and ports; zero lens flare or soft blur.

**Light.** Even overhead studio softbox with a clean directional rim that separates machined chamfers and recessed ports without casting heavy dark shadows.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Matte stone (`#F2EFE9`), brushed aluminum, and carbon black with one vermilion accent cap or cable (`#B82E16`) and one deep field-teal indicator (`#11645C`).

**Never:**
- Lifestyle models holding devices in cafes or bedrooms.
- Neon cyberpunk glow, purple gradients, or sci-fi holograms.
- Unstructured marketing prose without technical specifications or module numbers.
- Visible third-party brand logos or trademarked device silhouettes.

**Prompt skeleton.** `overhead flat-lay macro photograph of a modular anodized-aluminum field synthesizer and disassembled expansion modules arranged on a matte warm-stone surface, one vermilion rotary encoder cap, crisp machined chamfers and exposed fasteners, even softbox lighting, 4:3, no people, no logos`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Sequence hardware detail pages as: specimen hero → dense capability wall → numbered module breakdown cards → component repairability/upgrade spec table → compatible accessory cluster.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Space Grotesk; body: IBM Plex Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll. Collapse multi-column capability walls to two columns on tablet and one column on mobile, and keep module upgrade tables inside their own horizontal scroll region. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `icon-taxonomy` at `top`, with `76px` minimum height and `1320px` width (0px fills the available track). Use top navigation with a 1320px maximum width and 76px header height, grouping hardware categories (Instruments, Modules, Cables, Apparel, Support) with compact geometric glyphs. At compact widths, use single-column disclosure rows.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

## Hero

Use `specimen-poster`: copy share `42%`, media at `background` in a `4 / 3` frame, minimum height `700px`, title measure `14ch`, alignment `start` and desktop offset `40px`. Present one complete hardware specimen or exploded module array against the matte stone field with a numbered revision stamp (`REV 02 · FIELD SYSTEM`), concise technical tagline, and direct module/store actions.

Mobile: Below the theme's existing compact breakpoint: Put useful labels in a normal-flow caption block below the complete specimen; decorative title size must not cause horizontal scroll.

## Footer

Use `studio-address` with `4` desktop groups and `520px` minimum height. Reserve 520px as the desktop minimum closing height with 4 information columns or groups (Hardware lines, Module documentation & firmware, Repair guides & spare parts, Engineering studio coordinates). Do not collapse the whole footer to a generic four-column sitemap.

Mobile stacks the link groups, keeps the two office addresses side by side, and moves the large wordmark below them. Allow links to wrap and let the closing region grow with content.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slide composition: layout only; retain this system's own colours, fonts and image direction.

1920 x 1080; use --slide-* geometry and type. Keep required content inside --slide-pad-edge; captions at least 24px. No website navigation, hover or scrolling inside a slide.

- Cover: Visible construction grid with a two-line title crossing its central cells; one flat brand-accent ground.

- Body: Ruled report sheet: a full-width title rail above unequal text, photograph and annotation cells. Keep grid lines continuous.

- Evidence: Process photograph spans 8/12; left 4/12 carries the claim and a small data table; one accent note aligns to a grid intersection.

- Closing: An open construction grid with one action cell. Split dense printed report pages into several slides, never miniaturise them.

Sequence: cover > claim > evidence > implication > closing; repeat claim/evidence for longer decks, with a chapter after each topic. Do not repeat one body layout throughout. Use real supplied data and appropriate authored/generated images; capture actual app UI when demonstrating software. Split overflowing content instead of shrinking type.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (8% of the shorter side), place the primary figure at `--content-figure` (0.65) of the shorter side anchored center, and one deliberate full-bleed figure may cross the safe area because `--content-bleed` is `1`.

- Frame: anodized warm stone with carbon ink and hairline rules; signal vermilion marks the active module or rotary control.
- Composition: numbered module breakdown cells, all-caps capability lists, and component upgrade tables. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: precision portable hardware or disassembled expansion modules shot straight on.
- Never: lifestyle models, neon glow, unstructured marketing copy without module specifications.
