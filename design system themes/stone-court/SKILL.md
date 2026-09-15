---
name: builtin-stone-court-design
description: Use this bundled Stone Court Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation editorial-overlay → hero fullbleed-top (28% copy zone, background media, 16 / 9, 800px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Keep cool limestone, a didone statement voice and whole architectural plates with ground visible around them. Mono captions identify place, year and material; slate marks action. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.0` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `0%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Images are contained and do not bleed at all, because this system documents architecture and a cropped building is an unreadable building. The media and text tracks are equal at 1.0, giving the writing the same standing as the photograph.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An architectural exterior or a masonry detail — a courtyard, a facade, an arcade, a stair, a wall junction. Structure and material, not interiors.

**Treatment.** Formal architectural photography, square to the subject, with true verticals and no lens distortion. Cool neutral colour with stone, concrete, lime plaster and weathered metal reading accurately.

**Light.** Overcast or open-shade daylight with soft even shadows, or raking low sun where texture is the subject. Avoid harsh midday contrast.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Limestone, concrete grey, slate and weathered bronze. Cool neutral overall — the warm end of the spectrum belongs to a different system.

**Never:**
- Cropping into the structure or bleeding it off the frame edge.
- Warm golden-hour grading; this system is deliberately cool.
- Tilted verticals, fisheye, or extreme wide-angle drama.
- People, vehicles, or signage dominating the frame.

**Prompt skeleton.** `formal architectural photograph of a stone courtyard facade, square to the subject with true verticals, overcast soft even daylight, cool neutral limestone and concrete palette, structure complete inside the frame with clear space around it, landscape 3:2, no people, no distortion`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep cool limestone, a didone statement voice and whole architectural plates with ground visible around them. Mono captions identify place, year and material; slate marks action.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: DM Serif Display; body: Manrope; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use overlay navigation with a 1320px maximum width and 88px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Reference: https://www.navbar.gallery/navbar/clonix

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Keep the whole building or room contained inside an expansive scenic field; limit opening copy to a small corner and leave architecture unobstructed. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Reference: https://supahero.io/hero/dream-design-laboratory

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 560px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose location pair is a first-class structural feature. Do not collapse the whole footer to a generic four-column sitemap.

Reference: https://www.footer.design/sites/reality-is
