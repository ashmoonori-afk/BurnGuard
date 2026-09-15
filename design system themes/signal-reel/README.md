# Signal Reel Theme

Near-black ground, one signal red, and an oversized grotesque that runs past the frame.

## Files

- `colors_and_type.css` - canonical BurnGuard color, type, spacing, and shape tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart, type, spacing, radius, elevation, and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps for hierarchy and data visualization, and use `--r-*`, `--shadow-*`, and `--dur-*` tokens rather than introducing component-local scales.

## Layout

Use the existing 6-column body grid, none content maximum, 52ch reading measure and 0px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | none | Outer content width |
| `--layout-measure` | 52ch | Reading measure for body copy |
| `--layout-columns` | 6 | Base column count |
| `--layout-gutter` | 0px | Space between columns |
| `--layout-margin` | clamp(16px, 3vw, 40px) | Page side margin |
| `--layout-section-y` | clamp(28px, 4vw, 64px) | Vertical rhythm between sections |
| `--layout-rule` | 0px | Divider weight |
| `--layout-bp-md` / `--layout-bp-lg` | 720px / 1080px | Breakpoints |
| `--layout-hero` | 21 / 9 | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `side-rail` | Website navigation arrangement |
| `--layout-nav-position` | `side` | Website navigation position |
| `--layout-nav-height` | `80px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `184px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `filmstrip` | Opening composition |
| `--layout-hero-copy-ratio` | `86%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `3 / 4` | Opening media aspect ratio |
| `--layout-hero-media-position` | `below` | Opening media placement |
| `--layout-hero-min-height` | `700px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `16ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `scenic-overlay` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `640px` | Footer minimum height; content may grow |

## Composition

Navigation side-rail → hero filmstrip (86% copy zone, below media, 3 / 4, 700px minimum) → retain the existing theme-specific body hierarchy → footer scenic-overlay.

Use near-black with signal red reserved for live state and the primary action. Large display type supplies scale; keep every meaningful label readable, with zero radius and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Motion held still — a performer, a vehicle, a crowd, a machine mid-cycle. Energy must be visible in the frame.

**Treatment.** High-contrast capture with deep blacks that fall away into the page ground, visible grain, and a single hot highlight. Near-monochrome with the red surviving where it appears naturally.

**Light.** Hard directional or stage light with most of the frame dark. Blown highlights are acceptable; flat even light is not.

**Framing.** For the website opening, place this theme's source art in the 3 / 4 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Near-black with grey midtones and at most one red element. No other colour.

**Never:**
- Bright, evenly lit, or high-key frames.
- Multiple saturated colours competing with the signal red.
- Static, posed subjects with no implied movement.
- Frames with no dark region for the display type to cross.

**Prompt skeleton.** `high-contrast photograph of motion held still, hard directional stage light, deep blacks falling to near-black, visible grain, near-monochrome with a single red element, subject off-centre with a large dark region, wide crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Use near-black with signal red reserved for live state and the primary action. Large display type supplies scale; keep every meaningful label readable, with zero radius and no elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, and shape rules were composed for this theme; no third-party theme, stylesheet, palette, or asset is included, and it carries no external license obligation.

## Local typography

- Display: Anton; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Black Han Sans" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Keep a clearly grouped strip; use a finite two-column or single-column selection instead of body-level horizontal overflow. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile gives the scene its own tall area above a dark information region. Navigation becomes a two-column grid; a row of three small marks and the tagline follow. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `side-rail` at `side`, with `80px` minimum height and `184px` width (0px fills the available track). Use side navigation with a 184px maximum width and 80px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [side-rail](https://www.navbar.gallery/navbar/big-dirty-agency). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `filmstrip`: copy share `86%`, media at `below` in a `3 / 4` frame, minimum height `700px`, title measure `16ch`, alignment `center` and desktop offset `0px`. Introduce work as a cinematic horizontal strip after a centered masthead; a persistent narrow left rail replaces a conventional full-width header. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Keep a clearly grouped strip; use a finite two-column or single-column selection instead of body-level horizontal overflow. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile gives the scene its own tall area above a dark information region. Navigation becomes a two-column grid; a row of three small marks and the tagline follow.

Structural reference: [filmstrip](https://supahero.io/hero/did-global-cinema). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `scenic-overlay` with `3` desktop groups and `640px` minimum height. Reserve 640px as the desktop minimum closing height with 3 information columns or groups. Reserve a scenic field above a readable information zone on narrow screens. Use an original local background; do not depend on WebGL or video for access to navigation.

Mobile gives the scene its own tall area above a dark information region. Navigation becomes a two-column grid; a row of three small marks and the tagline follow. Allow links to wrap and let the closing region grow with content.

Structural reference: [scenic-overlay](https://www.footer.design/sites/eclipse-space). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
