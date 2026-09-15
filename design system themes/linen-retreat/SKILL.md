---
name: builtin-linen-retreat-design
description: Use this bundled Linen Retreat Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation profile-popover → hero fullbleed-top (54% copy zone, background media, 21 / 9, 700px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep linen, serif statements, heavily spaced eyebrows and the partial image bleed. Plain rooms, rates and arrival lists accompany one tan booking action; use restrained small radii. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-media-text-ratio` | `1.3` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `60%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery extends 60% of the way from the content edge toward the viewport edge — neither contained nor full-bleed. That halfway state is the system's signature: the page feels held rather than open. Media leads text slightly at 1.3.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A detail of a stay rather than a whole room — a made bed corner, a linen curtain in light, a table set for one, a bath, a view through a window. Intimate scale.

**Treatment.** Natural hospitality photography with soft warm colour, visible textile texture, and shallow depth so one element is sharp and the rest falls away. Unstyled and calm.

**Light.** Soft warm window light, early or late, with gentle gradation across the frame. Never flat, never contrasty.

**Framing.** For the website opening, place this theme's source art in the 21 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Linen, oat, tan, sage and warm shadow. Muted throughout; the strongest colour in frame should still be a neutral.

**Never:**
- Wide empty hotel-room shots that look like a booking listing.
- People posing, or staff in frame.
- Cool or clinical colour; the system depends on warmth.
- Hard flash, heavy contrast, or saturated accent objects.

**Prompt skeleton.** `intimate hospitality detail photograph, corner of a made bed with linen texture in soft warm window light, shallow depth of field, muted oat and tan palette, gentle gradation across the frame, subject off-centre with negative space, 4:3, no people, no staging`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep linen, serif statements, heavily spaced eyebrows and the partial image bleed. Plain rooms, rates and arrival lists accompany one tan booking action; use restrained small radii.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Playfair Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use overlay navigation with a 980px maximum width and 68px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Reference: https://www.navbar.gallery/navbar/hosier-brown

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Place a quiet centered title in a generous sky or ground zone above a panoramic scene; finish with a separate photograph and small paired link groups. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/end-speciesism

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 580px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Reference: https://www.footer.design/sites/carolyn-lee

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
