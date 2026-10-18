---
name: builtin-exploded-field-module-design
description: Use this bundled Exploded Field Module Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation icon-taxonomy → hero specimen-poster (42% copy zone, background media, 4 / 3, 700px minimum) → retain the existing theme-specific body hierarchy → footer studio-address.

Structure hardware detail pages as a field manual and teardown: open with the complete device specimen and model revision badge, follow with a dense all-caps capability wall (numbered 01–24 or 01–100), break the product into numbered hardware module sections (display assembly, signal engine, battery bay, expansion ports, tactile rotary controls), include a component-by-component repairability and upgrade specification table, and close with a 6-column compatible accessory grid. Signal vermilion (`--primary-blue`) marks the active rotary control, revision badge, or buy action; anodized stone and carbon ink carry everything else.

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
| `--family-ui-label-placement` | `beside` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Within the embedded work surface, navigation stays in a top strip with a 1px rule below so full-width module grids and repairability tables are never squeezed. Labels sit beside their controls in a two-track specification layout so capacity chips, port modules, and firmware options read like an engineering bill of materials.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Precision portable audio/compute hardware or modular electronics: a CNC-machined anodized aluminum chassis, exposed fastener heads, color-coded rotary encoders, or a flat-lay exploded teardown of internal modules on a stone mat.

**Treatment.** Crisp overhead or three-quarter macro product photography on a matte warm-stone ground matching `--bg`. High micro-contrast on knurled metal, legends, and ports; zero lens flare or soft blur.

**Light.** Even overhead studio softbox with a clean directional rim that separates machined chamfers and recessed ports without casting heavy dark shadows.

**Framing.** For the website opening, place this theme's source art in the 4 / 3 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Matte stone (`#F2EFE9`), brushed aluminum, and carbon black with one vermilion accent cap or cable (`#B82E16`) and one deep field-teal indicator (`#11645C`).

**Never:**
- Lifestyle models holding devices in cafes or bedrooms.
- Neon cyberpunk glow, purple gradients, or sci-fi holograms.
- Unstructured marketing prose without technical specifications or module numbers.
- Visible third-party brand logos or trademarked device silhouettes.

**Prompt skeleton.** `overhead flat-lay macro photograph of a modular anodized-aluminum field synthesizer and disassembled expansion modules arranged on a matte warm-stone surface, one vermilion rotary encoder cap, crisp machined chamfers and exposed fasteners, even softbox lighting, 4:3, no people, no logos`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Sequence hardware detail pages as: specimen hero → dense capability wall → numbered module breakdown cards → component repairability/upgrade spec table → compatible accessory cluster.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Space Grotesk; body: IBM Plex Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1320px maximum width and 76px header height, grouping hardware categories with compact geometric glyphs. At compact widths, use single-column disclosure rows.

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Present one complete hardware specimen or exploded module array against the matte stone field with a numbered revision stamp, concise technical tagline, and direct module/store actions.

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 520px as the desktop minimum closing height with 4 information columns or groups. Use an asymmetrical studio directory whose engineering and repair documentation links are first-class structural features.

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
