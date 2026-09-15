# Linen Retreat Theme

A hospitality system: linen ground, a high-contrast serif voice, and imagery that bleeds partway so the page feels held rather than open.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1320px content maximum, 58ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1320px` | Outer content width |
| `--layout-measure` | `58ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 64px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 8vw, 120px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 3` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `profile-popover` | Website navigation arrangement |
| `--layout-nav-position` | `overlay` | Website navigation position |
| `--layout-nav-height` | `68px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `980px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `fullbleed-top` | Opening composition |
| `--layout-hero-copy-ratio` | `54%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `21 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `700px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `17ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `40px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `photo-strip` | Footer arrangement |
| `--layout-footer-columns` | `2` | Desktop footer groups |
| `--layout-footer-height` | `580px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `1.3` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-spatial-image-bleed` | `60%` | How far designated images extend from the content edge toward the viewport edge; 0% contained, 100% full-bleed. |

Imagery extends 60% of the way from the content edge toward the viewport edge — neither contained nor full-bleed. That halfway state is the system's signature: the page feels held rather than open. Media leads text slightly at 1.3.

## Composition

Navigation profile-popover → hero fullbleed-top (54% copy zone, background media, 21 / 9, 700px minimum) → retain the existing theme-specific body hierarchy → footer photo-strip.

Keep linen, serif statements, heavily spaced eyebrows and the partial image bleed. Plain rooms, rates and arrival lists accompany one tan booking action; use restrained small radii. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

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

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Playfair Display; body: DM Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Gowun Batang" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow. Keep navigation bounded to the viewport and use semantic native disclosures for groups. Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `profile-popover` at `overlay`, with `68px` minimum height and `980px` width (0px fills the available track). Use overlay navigation with a 980px maximum width and 68px header height. At compact widths, use the FAQ chip and a single-column FAQ card. Keep the anchored popover within viewport width and preserve direct CTA access.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [profile-popover](https://www.navbar.gallery/navbar/hosier-brown). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `fullbleed-top`: copy share `54%`, media at `background` in a `21 / 9` frame, minimum height `700px`, title measure `17ch`, alignment `center` and desktop offset `40px`. Place a quiet centered title in a generous sky or ground zone above a panoramic scene; finish with a separate photograph and small paired link groups. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Separate text onto a readable ground when the crop removes its safe area; keep the scene and all essential links in normal flow.

Structural reference: [fullbleed-top](https://supahero.io/hero/end-speciesism). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `photo-strip` with `2` desktop groups and `580px` minimum height. Reserve 580px as the desktop minimum closing height with 2 information columns or groups. Separate a useful navigation band from an original local photo strip. Decorative shapes must not obscure or intercept links. Do not copy the person's portrait or brand assets.

Mobile puts the logo first, keeps the two link columns side by side underneath, then shows a tighter photograph crop below the credit line. Allow links to wrap and let the closing region grow with content.

Structural reference: [photo-strip](https://www.footer.design/sites/carolyn-lee). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
