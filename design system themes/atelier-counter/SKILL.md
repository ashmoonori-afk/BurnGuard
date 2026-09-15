---
name: builtin-atelier-counter-design
description: Use this bundled Atelier Counter Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation profile-popover → hero type-marquee (84% copy zone, background media, 4 / 5, 760px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep warm bone paper, didone brand voice, contained product plates and a humanist reading face. Oxblood marks price or action; use hairline rows and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-commerce-gallery-layout` | `lead-and-pairs` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `flow` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

The gallery opens with one full-width lead plate and continues in pairs, which gives a product page an opening statement before its detail. Images are contained so the whole object stays visible — in this system the product's silhouette is the selling point. The purchase panel stays in flow so the page reads as a description rather than a conversion funnel.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single object presented whole — a garment laid flat, a bag upright, a shoe in profile, an accessory arranged. The complete silhouette must be visible.

**Treatment.** Bright even product photography on a bone or oat seamless that matches the page ground, so the object appears to rest on the paper. Accurate material colour, visible texture, no gloss.

**Light.** Broad soft frontal daylight with a faint contact shadow to seat the object. Almost no modelling; the silhouette matters more than the volume.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Bone and oat surroundings with the product's own colour as the single chroma. Warm cast throughout so it sits on the warm page.

**Never:**
- Cropping the object at the frame edge; the whole silhouette must read.
- Cool grey or white-blue seamless that fights the warm paper.
- Models posing in a scene — this system presents goods, not lifestyle.
- Drop shadows or reflections added in post.

**Prompt skeleton.** `product photograph of a single object presented whole on a bone seamless background, broad soft frontal daylight, faint contact shadow, complete silhouette visible with margin inside the frame, warm accurate material colour, vertical 4:5, no crop, no gloss`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep warm bone paper, didone brand voice, contained product plates and a humanist reading face. Oxblood marks price or action; use hairline rows and no elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Bodoni Moda; body: Figtree; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1320px maximum width and 76px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Reference: https://www.navbar.gallery/navbar/hosier-brown

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Layer very large display type beside or around a complete contained object; the original object must stay whole even when decorative type reaches the edges. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Reference: https://supahero.io/hero/red-antler

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 520px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Reference: https://www.footer.design/sites/carolyn-lee
