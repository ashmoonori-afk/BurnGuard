---
name: builtin-signal-console-design
description: Use this bundled Signal Console Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation icon-taxonomy → hero product-panel (50% copy zone, below media, 16 / 10, 600px minimum) → retain the existing theme-specific body hierarchy → footer retail-accordion.

Keep near-black with phosphor reserved for live states. Mono labels and numbered annotations support a real product surface; use hairline regions, no shadows and radii at or below 3px. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether embedded-workspace navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation is a single top row at `--layout-nav-h`; the span value is inert here and exists so a side-navigation variant stays expressible. Labels stack above their control so a dense form keeps one reading column.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Hardware and interface: a rack, a board, a device edge, or a close macro of a connector, shot as an object rather than a scene. No people, no desks, no offices.

**Treatment.** Photographic, high fidelity, matte surfaces, deep blacks that stay black. Fine machined detail preserved. No gloss, no lens flare, no bokeh-heavy blur.

**Light.** Single cool key from one side against a very dark field, with controlled falloff. Small phosphor-green emissive points may appear as status indicators and are the only saturated colour in frame.

**Framing.** For the website opening, place this theme's source art in the 16 / 10 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Near-black ground with cool grey mid-tones; the only chroma is the phosphor green of indicator lights, matching `--primary-blue`. Treat any other hue as a defect.

**Never:**
- Stock-photo people, handshakes, or open-plan offices.
- Blue-glow 'cyber' gradients, circuit-board overlays, or holographic UI clichés.
- Warm ambient light or amber practicals — they break the single-signal rule.
- Visible brand marks or readable third-party logos.

**Prompt skeleton.** `macro photograph of matte-black server hardware, single cool key light from the left, deep black background, small green status LEDs, fine machined detail, no people, no logos, tight frontal crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep near-black with phosphor reserved for live states. Mono labels and numbered annotations support a real product surface; use hairline regions, no shadows and radii at or below 3px.
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

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1380px maximum width and 92px header height. At compact widths, use product/use-case/enterprise disclosure rows. Use single-column disclosures; keep the promotional card secondary.

Reference: https://www.navbar.gallery/navbar/velt

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Use a shallow introduction/action row above a wide interface panel; reserve navigation taxonomy for compact categorized groups. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/modify

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 440px as the desktop minimum closing height with 4 information columns or groups. Use native details/summary for the narrow-screen navigation groups if disclosure is needed. The desktop gallery screenshot does not establish a working subscription form, so provide one only when backed by a real flow.

Reference: https://www.footer.design/sites/outway

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
