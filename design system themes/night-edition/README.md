# Night Edition Theme

A dark reading edition where the page is ink, the serif is set light, and one warm signal marks the current article.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1100px content maximum, 66ch reading measure and 24px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1100px` | Outer content width |
| `--layout-measure` | `66ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 5vw, 72px)` | Page side margin |
| `--layout-section-y` | `clamp(60px, 8vw, 120px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `segmented-pill` | Website navigation arrangement |
| `--layout-nav-position` | `bottom` | Website navigation position |
| `--layout-nav-height` | `72px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `900px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `type-marquee` | Opening composition |
| `--layout-hero-copy-ratio` | `90%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `21 / 9` | Opening media aspect ratio |
| `--layout-hero-media-position` | `background` | Opening media placement |
| `--layout-hero-min-height` | `720px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `11ch` | Maximum title line measure |
| `--layout-hero-align` | `center` | Hero copy alignment |
| `--layout-hero-offset` | `0px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `window-stage` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `620px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `3 / 2` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `spaced` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Paragraphs are spaced rather than indented: on a dark ground an indent is hard to perceive, so separation has to come from a gap. Images cover their frame and are allowed to run wider than the measure to give the column relief.

## Composition

Navigation segmented-pill → hero type-marquee (90% copy zone, background media, 21 / 9, 720px minimum) → retain the existing theme-specific body hierarchy → footer window-stage.

Keep the ink ground, readable serif body and loose leading. Warm signal marks the active article or reading progress; images provide the large bright areas without extra accents. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Night and low-light subjects: a lit interior seen from outside, a street after dark, a stage, a lamp-lit desk. The image should belong to the same hour as the page.

**Treatment.** Low-key photography with deep shadow retention and controlled highlight. Detail lives in the mid-tones; blacks stay black rather than lifting to grey.

**Light.** Practical sources within the frame — a window, a lamp, a sign. Warm sources preferred so they rhyme with the accent.

**Framing.** For the website opening, place this theme's source art in the 21 / 9 frame at background specified by Hero; keep its subject, medium, light and grading. Keep the principal subject readable and use negative space without changing the source-art identity. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Ink and charcoal with warm practical highlights matching `--primary-blue`. Cool blue-dominant night images fight the warm signal and should be avoided.

**Never:**
- Brightly lit daytime scenes — they punch a hole in the page.
- Lifted, hazy blacks or heavy film-grain overlays.
- Cool blue night grading that clashes with the warm accent.
- Placing an image against a light panel; it sits on the ink ground directly.

**Prompt skeleton.** `low-key night photograph, warm practical light sources inside the frame, deep retained shadows, true blacks, detail in the mid-tones, substantial dark area in the composition, warm amber highlights, no daylight`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the ink ground, readable serif body and loose leading. Warm signal marks the active article or reading progress; images provide the large bright areas without extra accents.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Scale display lettering within the viewport; keep a static readable ticker and honor reduced motion if any movement is introduced. Reserve bottom safe-area space and keep the segmented navigation from covering content. Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `segmented-pill` at `bottom`, with `72px` minimum height and `900px` width (0px fills the available track). Use bottom navigation with a 900px maximum width and 72px header height. Mobile screenshot has product CTA and close above large stacked product/ecosystem/company rows. Keep grouping and use stacked drill-down rows.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [segmented-pill](https://www.navbar.gallery/navbar/consensys). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `type-marquee`: copy share `90%`, media at `background` in a `21 / 9` frame, minimum height `720px`, title measure `11ch`, alignment `center` and desktop offset `0px`. Use an enormous two-line typographic poster and a ticker as the main geometry, with the segmented navigation reserved along the bottom edge. Retain the theme's existing image-fit, palette, font family and locally generated art unless a written theme invariant requires a more protective framing.

Mobile: Below the theme's existing compact breakpoint: Scale display lettering within the viewport; keep a static readable ticker and honor reduced motion if any movement is introduced. Reserve bottom safe-area space and keep the segmented navigation from covering content. Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells.

Structural reference: [type-marquee](https://supahero.io/hero/tigran-azatyan). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `window-stage` with `3` desktop groups and `620px` minimum height. Reserve 620px as the desktop minimum closing height with 3 information columns or groups. Build the footer as title stage, compact link panels, then a three-cell brand band. Keep panels in normal document flow on narrow screens; animation is optional.

Mobile centers the title and one visible link window in a vertical stack, retaining the ticker and three equal bottom glyph cells. Allow links to wrap and let the closing region grow with content.

Structural reference: [window-stage](https://www.footer.design/sites/the-design-society). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
