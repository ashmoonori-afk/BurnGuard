---
name: builtin-long-form-press-design
description: Use this bundled Long Form Press Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation side-rail → hero split-reverse (52% copy zone, left media, 4 / 5, 680px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep the continuous serif reading column, generous leading and indented paragraphs. Rust marks links and pull quotes; sans captions and mono dates support the prose. No cards or elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-media-text-ratio` | `3 / 2` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `indented` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Images are contained, never cropped, because in this system a photograph is a document rather than a texture. Paragraphs use a 1em first-line indent with no gap between them, except immediately after a heading or a block interruption, which is how continuous prose is set on paper.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Reportage and documentary subjects: a person at work, a place with weather in it, an object in its real context. The photograph should carry information, not mood alone.

**Treatment.** Natural-light documentary photography, film-like tonality, visible grain acceptable. True colour rather than heavy grading. Composition should survive being printed in a single column.

**Light.** Available light, whatever the scene actually has. Overcast, window light, late afternoon. Never studio-lit, never artificially separated from the background.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at left specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Muted naturals that sit comfortably on warm paper: earth, stone, foliage, denim. Saturation restrained so the rust accent stays the strongest colour on the page.

**Never:**
- Studio seamless backgrounds or cut-out objects.
- Heavy colour grading, teal-and-orange, or filter looks.
- Stock-photo staging with models performing an emotion.
- Images cropped to a square grid cell — they are sized against the measure.

**Prompt skeleton.** `documentary photograph in available overcast light, a person working in a real environment, film-like natural colour, subtle grain, wide contextual framing, muted earth palette, no studio lighting, no staging`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the continuous serif reading column, generous leading and indented paragraphs. Rust marks links and pull quotes; sans captions and mono dates support the prose. No cards or elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for captions and UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use side navigation with a 200px maximum width and 80px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Reference: https://www.navbar.gallery/navbar/big-dirty-agency

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Preserve a complete document or image on the left and a narrow right heading, with a second substantial paragraph aligned along the lower baseline. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Reference: https://supahero.io/hero/habito

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 420px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Reference: https://www.footer.design/sites/harvest-hall
