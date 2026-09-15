---
name: builtin-exhibit-wall-design
description: Use this bundled Exhibit Wall Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation profile-popover → hero portfolio-peek (46% copy zone, below media, 4 / 5, 680px minimum) → retain the existing theme-specific body hierarchy → footer centered-cta.

Keep warm plaster visible around complete works. Serif wall text and mono labels provide title, year, medium and dimensions; clay marks action, with zero radius and elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-creative-type-rotation` | `0deg` | Rotation applied to a designated display composition about its own centre. |
| `--family-creative-line-step` | `3ch` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `0%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

Display lines step three characters further along the inline axis on each successive line, producing a staircase that reads as a hand-set wall text. Nothing rotates and nothing overlaps imagery: in this system the work is never touched by type.

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

## Local typography

- Display: Fraunces; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1300px maximum width and 72px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Reference: https://www.navbar.gallery/navbar/hosier-brown

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Stage one complete work with neighboring preview windows; preserve the full artwork and use a small closing action rather than dense links. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Reference: https://supahero.io/hero/gallereee

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 400px as the desktop minimum closing height with one information group. Use a conversion-focused footer with one primary action and a small secondary link row. Keep decorative wordmarks separate from accessible link labels.

Reference: https://www.footer.design/sites/cronicle
