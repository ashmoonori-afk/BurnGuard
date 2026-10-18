---
name: builtin-modular-configurator-design
description: Use this bundled Modular Configurator Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation enterprise-columns → hero product-panel (46% copy zone, below media, 16 / 10, 640px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Structure product detail pages around system adaptability: open with designer credit and longevity claim, present a live configuration matrix (module bay dimensions, finish swatches with exact colour codes, surface/wall compatibility checklist), follow with an orthographic dimension diagram and tabular spec sheet, and close with planner consultation or direct modular checkout. Keep 1px hairline borders, tabular mono dimensions and zero elevation.

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
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

The gallery opens with one wide system elevation and continues in paired detail views (joint close-up, bay configuration, surface load, wall-mounting guide). Images stay contained so modular bays, ball joints and dimension callouts are never cropped. On detail pages, the right-hand configuration rail pins while the user steps through bay width, height ladder, finish swatches, ergonomic size class (A / B / C), and mounting surface assessment.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A modular shelving, storage, or ergonomic seating system photographed straight-on in an architectural gallery space, or an orthographic assembly elevation showing tubes, joints, and panels.

**Treatment.** High-key architectural product photography on a cool gallery-white ground matching `--bg`. Crisp chrome, powder-coated steel, and anodized aluminum edges with zero motion blur or atmospheric haze.

**Light.** Cool north-light studio illumination: even across the full bay width with clean specular highlights along structural joints and a soft floor contact shadow.

**Framing.** For the website opening, place this theme's source art in the 16 / 10 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Gallery paper and graphite structure with one cobalt-chrome or powder-coated primary accent panel echoing `--primary-blue`.

**Never:**
- Warm lifestyle clutter, scattered domestic props, or people posing on furniture.
- Tilted Dutch angles or wide-angle lens distortion that bends vertical upright tubes.
- Heavy drop shadows, dark moody vignetting, or unlabelled decorative renders.
- Visible third-party logos or watermarks.

**Prompt skeleton.** `orthographic front elevation photograph of a modular chrome-and-steel shelving system in a plain white gallery room, crisp ball joints and powder-coated cobalt and graphite panels, cool even north daylight, clean floor shadow, 16:10, no props, no people`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Structure detail pages with a lead system view, paired joint/finish macro plates, a sticky configuration rail (dimensions, finish swatches, ergonomic sizes, wall-mount guide), and a tabular specification sheet.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Space Grotesk; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1360px maximum width and 84px header height, pairing a utility specification strip above system family links. At compact widths, collapse groups into semantic native disclosures.

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Open with a system longevity claim and quicklinks above a full-width contained system panel with live bay/dimension status readouts. Retain object-fit: contain for the original artwork.

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 480px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address and specification-sheet ledger.

## Surfaces

Pick the surface that matches the deliverable and declare its tokens in the authored CSS: `surfaces/website.css` (`--web-*`) for pages, `surfaces/slides.css` (`--slide-*`) for 1920x1080 decks, `surfaces/content.css` (`--content-*`) for fixed artboards. `README.md` carries the composition rules under `## Slide deck` and `## Content artboards`; never carry a website grid, navigation bar or reading measure into a fixed frame.
