---
name: builtin-night-marquee-design
description: Use this bundled Night Marquee Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation side-rail → hero type-marquee (100% copy zone, below media, 21 / 9, 700px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep the cinematic still, achromatic chrome and small letterspaced credits. Dark space and scale carry the atmosphere, with no raised surfaces. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-creative-type-image-overlap` | `100%` | How far a display block translates over preceding imagery, as a share of its own block-size. |

The display block sits fully over its still — the overlap is total, which is what makes the page a title card rather than a page with a picture on it. Nothing rotates and no line steps: the composition is strictly centred, and the stillness is the effect.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single human moment held still — a face in half-light, a figure in a doorway, hands at rest. It should read as a frame lifted out of a longer sequence, not as a posed portrait.

**Treatment.** Cinematic capture with visible grain, shallow depth of field, and deep crushed shadows that fall to near-black so the frame merges with the page ground. Colour muted to near-monochrome with one cool cast surviving in the shadows.

**Light.** Low-key and directional — a single practical source, most of the frame in shadow, a narrow highlight describing the subject. No fill. The darkest quarter of the frame should be effectively black.

**Framing.** For the website opening, place this theme's source art in the 21 / 9 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Near-black with a cool teal or indigo cast in the shadows and a single warm practical light. No saturated colour anywhere.

**Never:**
- Bright, evenly lit, or high-key frames — they break the merge with the page.
- Busy compositions with no empty region for the title stack.
- Posed studio portraits or stock-looking smiles.
- Heavy colour grading toward orange and teal clichés.

**Prompt skeleton.** `cinematic film still, single human moment in low-key directional light, most of frame in deep shadow falling to near-black, shallow depth of field, visible grain, near-monochrome with a cool cast in the shadows, subject off-centre leaving empty dark space, 16:9`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the cinematic still, achromatic chrome and small letterspaced credits. Dark space and scale carry the atmosphere, with no raised surfaces.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Instrument Serif; body: Instrument Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use side navigation with a 160px maximum width and 72px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Reference: https://www.navbar.gallery/navbar/big-dirty-agency

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Use a large empty field and bottom-entering display word as the first fold, with a narrow side rail and a separate window-stage closing rhythm. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/exat

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 600px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Reference: https://www.footer.design/sites/the-design-society
