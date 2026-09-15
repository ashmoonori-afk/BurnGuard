---
name: builtin-vitrine-mono-design
description: Use this bundled Vitrine Mono Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation editorial-overlay → hero masthead-crop (38% copy zone, background media, 1 / 1, 720px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Keep goods as exhibits in shared-edge ruled cells. Contain the objects, place mono specifications beneath them and use position or rule weight for emphasis; zero radius. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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
| `--family-commerce-gallery-layout` | `paired` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `flow` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

Paired cells let two exhibits be compared directly, which is the point of a case. Images are contained so the object is documented rather than cropped for effect. The purchase control sits in flow at the end of the specification list, treated as one more field.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single object documented straight on or in strict profile, as a museum record shot. Tools, hardware, ceramics, instruments — objects with describable specifications.

**Treatment.** Flat, even record photography on a light achromatic ground matching the page. No styling, no atmosphere, no artful angle. The object is being catalogued.

**Light.** Completely even and shadowless, or with a single faint contact shadow. Nothing dramatic; legibility of form and material is the only goal.

**Framing.** For the website opening, place this theme's source art in the 1 / 1 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Achromatic ground with the object's true material colour. Grey, bone, steel, unglazed clay. Any saturated colour must come from the object itself.

**Never:**
- Angled hero shots or perspective drama — these are record images.
- Coloured or gradient backdrops.
- Props, hands, styling surfaces, or context of any kind.
- Cropping the object; it must be fully contained with even margin.

**Prompt skeleton.** `flat museum record photograph of a single object, centred with equal margin on a light achromatic seamless background, completely even shadowless lighting, orthographic straight-on view, true material colour, square 1:1, no styling, no props`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep goods as exhibits in shared-edge ruled cells. Contain the objects, place mono specifications beneath them and use position or rule weight for emphasis; zero radius.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Geist; body: Geist; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1200px maximum width and 80px header height. At compact widths, use one vertical large-link list with close control. Stack links first; featured work and contact information follow.

Reference: https://www.navbar.gallery/navbar/clonix

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Give a complete product or object the largest possible contained footprint beneath sparse metadata; crop only decorative framing, never the object. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Reference: https://supahero.io/hero/lax-chee

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 460px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Reference: https://www.footer.design/sites/esr
