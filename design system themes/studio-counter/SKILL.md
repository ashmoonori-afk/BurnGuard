---
name: builtin-studio-counter-design
description: Use this bundled Studio Counter Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation icon-taxonomy → hero framed-cover (66% copy zone, background media, 4 / 3, 660px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep photography dominant and chrome compact. Paired product rows retain tight gaps; bone-on-black or black-on-bone actions and large scale differences replace coloured emphasis. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-commerce-gallery-layout` | `paired` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

Products run in equal pairs so the eye compares rather than scans. Images cover their frame; the crop is part of the merchandising. The purchase panel pins within its product section and returns to flow below `--layout-bp-md` — it never becomes a floating duplicate bar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single garment or object on a body or a form, shot in a studio. The product is the whole subject; no environment, no narrative scene.

**Treatment.** Studio product photography on a mid-grey or charcoal seamless, matching the page ground closely enough that the frame edge is the only boundary. Matte, true-to-material colour, fine fabric or surface detail preserved.

**Light.** Controlled studio light with soft modelling — enough shadow to describe form and material, never flat, never dramatic. Keep the background falling darker than the subject.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Charcoal to near-black surroundings with the product's own material colour as the only chroma. Consecutive images in a pair should agree tonally so the row reads as one field.

**Never:**
- White or bright seamless backgrounds; they tear a hole in the dark page.
- Lifestyle scenes, locations, or props competing with the product.
- Visible logos, tags, or readable brand marks.
- Heavy retouching gloss or plastic-looking skin and fabric.

**Prompt skeleton.** `studio product photograph on charcoal seamless background, single garment on a form, soft controlled modelling light, matte true-to-material colour, fine fabric detail, vertical 4:5 crop, background darker than subject, no logos, no props`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep photography dominant and chrome compact. Paired product rows retain tight gaps; bone-on-black or black-on-bone actions and large scale differences replace coloured emphasis.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1180px maximum width and 80px header height. At compact widths, use product/use-case/enterprise disclosure rows. Use single-column disclosures; keep the promotional card secondary.

Reference: https://www.navbar.gallery/navbar/velt

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Enclose the original product scene in a strong framed campaign panel; concentrate the text and object around one central axis before a retail directory. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/grink

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 500px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Reference: https://www.footer.design/sites/outway
