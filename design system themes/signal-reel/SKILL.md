---
name: builtin-signal-reel-design
description: Use this bundled Signal Reel Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation side-rail → hero filmstrip (86% copy zone, below media, 3 / 4, 700px minimum) → retain the existing theme-specific body hierarchy → footer scenic-overlay.

Use near-black with signal red reserved for live state and the primary action. Large display type supplies scale; keep every meaningful label readable, with zero radius and no elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

Media is full-bleed with no container and no gutter, and sections butt directly against each other. Text blocks keep a small margin and section rhythm so a tight-leading display line never crops against the viewport edge. Type is positioned over the media, and the display line is allowed to crop at the viewport edge.

## Composition

Work on a near-black ground with exactly one signal red, used for live state, the primary action and nothing else. The display face is oversized to the point of running past the frame: set it so lines are clipped by the viewport edge on purpose, which is the system's signature. Body copy holds to a short 52ch measure and sits well away from the display, so the two never compete. Sections are separated by wide dark space rather than by rules. Radius is zero and nothing is elevated — on this ground a shadow is invisible anyway, so depth is expressed by scale alone.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Motion held still — a performer, a vehicle, a crowd, a machine mid-cycle. Energy must be visible in the frame.

**Treatment.** High-contrast capture with deep blacks that fall away into the page ground, visible grain, and a single hot highlight. Near-monochrome with the red surviving where it appears naturally.

**Light.** Hard directional or stage light with most of the frame dark. Blown highlights are acceptable; flat even light is not.

**Framing.** For the website opening, place this theme's source art in the 3 / 4 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Near-black with grey midtones and at most one red element. No other colour.

**Never:**
- Bright, evenly lit, or high-key frames.
- Multiple saturated colours competing with the signal red.
- Static, posed subjects with no implied movement.
- Frames with no dark region for the display type to cross.

**Prompt skeleton.** `high-contrast photograph of motion held still, hard directional stage light, deep blacks falling to near-black, visible grain, near-monochrome with a single red element, subject off-centre with a large dark region, wide crop`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Use near-black with signal red reserved for live state and the primary action. Large display type supplies scale; keep every meaningful label readable, with zero radius and no elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Anton; body: Public Sans; numbers/code: JetBrains Mono with tabular numerals. Korean fallback: "Black Han Sans" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use side navigation with a 184px maximum width and 80px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Reference: https://www.navbar.gallery/navbar/big-dirty-agency

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Introduce work as a cinematic horizontal strip after a centered masthead; a persistent narrow left rail replaces a conventional full-width header. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/did-global-cinema

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 640px as the desktop minimum closing height with 3 information columns or groups. Reserve a scenic field above a readable information zone on narrow screens. Use an original local background; do not depend on WebGL or video for access to navigation.

Reference: https://www.footer.design/sites/eclipse-space
