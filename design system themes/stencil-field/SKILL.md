---
name: builtin-stencil-field-design
description: Use this bundled Stencil Field Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation segmented-pill → hero masthead-crop (90% copy zone, background media, 16 / 9, 680px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep the spacious field, saturated media and wide display face. Green marks links or live states only; thin rules and a single deliberate image/type seam carry the structure. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-creative-line-step` | `0px` | Successive display lines shift by `n x step` along the inline axis, starting at line zero. |
| `--family-creative-type-image-overlap` | `24%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The display block translates up by roughly a quarter of its own height, so its first line crosses back over the media band it follows. That single overlap is the whole trick of the system: type and image are one object at exactly one seam, and everywhere else they stay apart.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** An abstract material close-up — poured pigment, blown glass, folded metal, dyed textile. No identifiable object, no person, no place. The image is a colour event.

**Treatment.** Macro or near-macro photography with the material filling the entire frame, saturated to the edge of plausible but still physical. Surfaces glossy or wet so light travels through them.

**Light.** Bright, wrapping, high-key light with specular highlights. The material should look self-luminous rather than lit from one side.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** One dominant saturated hue occupying most of the frame, with its own highlights and shadows as the only variation. Different sections may use different hues, but never two competing hues in one frame.

**Never:**
- Recognisable objects, people, logos, or places.
- Muted, dusty, or pastel treatments — the band must be loud against the pale field.
- Multiple competing hues in a single frame.
- Narrow crops with a clear subject; this is a band, not a picture.

**Prompt skeleton.** `ultra-wide macro photograph of an abstract glossy material surface filling the frame, single dominant saturated hue, bright wrapping high-key light with specular highlights, wet luminous texture, no recognisable object, 21:9 band crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the spacious field, saturated media and wide display face. Green marks links or live states only; thin rules and a single deliberate image/type seam carry the structure.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Syne; body: Space Grotesk; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1120px maximum width and 80px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Reference: https://www.navbar.gallery/navbar/consensys

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Retain a hard seam from a dominant media band to the statement; the portrait-centered reference informs scale, not permission to erase the seam. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/lando-norris

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 440px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Reference: https://www.footer.design/sites/harvest-hall
