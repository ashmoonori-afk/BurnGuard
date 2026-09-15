---
name: builtin-night-edition-design
description: Use this bundled Night Edition Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation segmented-pill → hero type-marquee (90% copy zone, background media, 21 / 9, 720px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep the ink ground, readable serif body and loose leading. Warm signal marks the active article or reading progress; images provide the large bright areas without extra accents. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `3 / 2` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `spaced` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Paragraphs are spaced rather than indented: on a dark ground an indent is hard to perceive, so separation has to come from a gap. Images cover their frame and are allowed to run wider than the measure to give the column relief.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Night and low-light subjects: a lit interior seen from outside, a street after dark, a stage, a lamp-lit desk. The image should belong to the same hour as the page.

**Treatment.** Low-key photography with deep shadow retention and controlled highlight. Detail lives in the mid-tones; blacks stay black rather than lifting to grey.

**Light.** Practical sources within the frame — a window, a lamp, a sign. Warm sources preferred so they rhyme with the accent.

**Framing.** For the website opening, place this theme's source art in the 21 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Ink and charcoal with warm practical highlights matching `--primary-blue`. Cool blue-dominant night images fight the warm signal and should be avoided.

**Never:**
- Brightly lit daytime scenes — they punch a hole in the page.
- Lifted, hazy blacks or heavy film-grain overlays.
- Cool blue night grading that clashes with the warm accent.
- Placing an image against a light panel; it sits on the ink ground directly.

**Prompt skeleton.** `low-key night photograph, warm practical light sources inside the frame, deep retained shadows, true blacks, detail in the mid-tones, substantial dark area in the composition, warm amber highlights, no daylight`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the ink ground, readable serif body and loose leading. Warm signal marks the active article or reading progress; images provide the large bright areas without extra accents.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use bottom navigation with a 900px maximum width and 72px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Reference: https://www.navbar.gallery/navbar/consensys

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Use an enormous two-line typographic poster and a ticker as the main geometry, with the segmented navigation reserved along the bottom edge. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/tigran-azatyan

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 620px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Reference: https://www.footer.design/sites/the-design-society
