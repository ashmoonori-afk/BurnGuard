---
name: builtin-daylight-press-design
description: Use this bundled Daylight Press Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference color, type, spacing, radius, elevation, and motion tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Reference shared local fonts while working; include required font files and licenses on export. No CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Navigation mega-feature → hero framed-cover (70% copy zone, below media, 16 / 9, 640px minimum) → retain the existing theme-specific body hierarchy → footer contact-ledger.

Use warm off-white paper, soft lowercase display type, buttercup only for action and active state, pill actions and warm hairline dividers. Keep the body approachable and printed. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max` with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by `--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Secondary media defaults to `--layout-hero`; website opening media uses `--layout-hero-media-ratio` and the Hero section.

Generous single-column flow with wide side margins; two-up image pairs at most. Vertical rhythm is deliberately large so the page breathes, and the primary action sits alone on its own line.

## Composition

Set everything on warm off-white paper with one buttercup accent reserved for the primary action and the active state. The display face is soft and lowercase — no uppercase display line exists in this system — and it sits at a friendly rather than a monumental scale. Body copy runs to a comfortable 62ch measure with generous leading. Actions are fully rounded pills, which is the only place roundness appears at that strength; cards and images take a smaller radius. Dividers are hairlines in a warm grey. The page should read as approachable and printed rather than engineered.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Everyday life at close range — hands at work, a table, a walk, an ordinary object in use. Warm and unremarkable by design.

**Treatment.** Natural photography with warm colour, gentle contrast, and film-like softness. Nothing clinical, nothing dramatic.

**Light.** Soft diffused daylight, slightly overexposed toward the highlights so the frame sits comfortably on the warm paper.

**Framing.** For the website opening, place this theme's source art in the 16 / 9 frame at below specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Warm off-white, buttercup, straw and soft neutrals. Any strong colour in frame should be warm.

**Never:**
- Cool or blue-grey grading; it turns the paper grey.
- Hard shadows, heavy contrast, or dramatic light.
- Corporate or stock-looking staged scenes.
- Baked-in rounded corners or borders in the image file.

**Prompt skeleton.** `natural photograph of an everyday close-range moment, soft diffused daylight lifted toward the highlights, warm gentle contrast, film-like softness, relaxed composition, warm straw and off-white palette, no drama`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Use warm off-white paper, soft lowercase display type, buttercup only for action and active state, pill actions and warm hairline dividers. Keep the body approachable and printed.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Local typography

- Display: Outfit; body: DM Sans; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body, "Gowun Batang" for serif; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Required layout

Read Navigation, Hero, Footer, Layout and Responsive in README.md before arranging content. Apply the named region patterns and every corresponding --layout-* value; use family tokens for the body. Preserve the theme identity and supplied art. Direction variants may change emphasis but retain these regions unless the user overrides them. Check wide and narrow rendering and 200% zoom.

## Navigation

Follow README.md's Navigation section and the corresponding --layout-* tokens. Use top navigation with a 1280px maximum width and 96px header height. At compact widths, use brand plus close control and stacked product/service disclosures. Stack columns and move featured content below links.

Reference: https://www.navbar.gallery/navbar/chesapeake-plywood

## Hero

Follow README.md's Hero section and the corresponding --layout-* tokens. Build a publication-style masthead above a bounded cover panel, then transition through a ruled compact contact colophon. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Reference: https://supahero.io/hero/spectrum-life

## Footer

Follow README.md's Footer section and the corresponding --layout-* tokens. Reserve 440px as the desktop minimum closing height with 3 information columns or groups. Use whitespace and a vertically organized address ledger rather than many equal navigation columns. Give contact details readable minimum type sizes.

Reference: https://www.footer.design/sites/esr
