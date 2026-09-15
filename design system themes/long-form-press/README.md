# Long Form Press Theme

A reading system first: a single serif measure, leading set for sustained prose, and photography sized against the text rather than a grid.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Use the existing 12-column body grid, 1140px content maximum, 68ch reading measure and 28px gutters. Website Navigation, Hero and Footer below define the opening and closing geometry. They take priority over generic body or embedded-workspace defaults.

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1140px` | Outer content width |
| `--layout-measure` | `68ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `28px` | Space between columns |
| `--layout-margin` | `clamp(20px, 5vw, 80px)` | Page side margin |
| `--layout-section-y` | `clamp(64px, 8vw, 128px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `3 / 2` | Secondary-media fallback ratio; the opening uses --layout-hero-media-ratio |

| Website token | Value | Meaning |
|---|---|---|
| `--layout-nav-pattern` | `side-rail` | Website navigation arrangement |
| `--layout-nav-position` | `side` | Website navigation position |
| `--layout-nav-height` | `80px` | Website navigation minimum height; allow wrapping |
| `--layout-nav-width` | `200px` | Website navigation width; 0px uses available width |
| `--layout-hero-pattern` | `split-reverse` | Opening composition |
| `--layout-hero-copy-ratio` | `52%` | Copy share in the hero composition |
| `--layout-hero-media-ratio` | `4 / 5` | Opening media aspect ratio |
| `--layout-hero-media-position` | `left` | Opening media placement |
| `--layout-hero-min-height` | `680px` | Opening minimum height, not a clipping boundary |
| `--layout-hero-title-measure` | `14ch` | Maximum title line measure |
| `--layout-hero-align` | `end` | Hero copy alignment |
| `--layout-hero-offset` | `80px` | Desktop composition offset; reset on small screens |
| `--layout-footer-pattern` | `ruled-community` | Footer arrangement |
| `--layout-footer-columns` | `3` | Desktop footer groups |
| `--layout-footer-height` | `420px` | Footer minimum height; content may grow |

## Family tokens

These are body-content and embedded-workspace defaults. The website shell uses Navigation, Hero and Footer instead; in particular, --family-ui-navigation-* describes navigation inside an embedded work surface and --family-media-text-ratio describes paired body sections.

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `3 / 2` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `indented` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Images are contained, never cropped, because in this system a photograph is a document rather than a texture. Paragraphs use a 1em first-line indent with no gap between them, except immediately after a heading or a block interruption, which is how continuous prose is set on paper.

## Composition

Navigation side-rail → hero split-reverse (52% copy zone, left media, 4 / 5, 680px minimum) → retain the existing theme-specific body hierarchy → footer ruled-community.

Keep the continuous serif reading column, generous leading and indented paragraphs. Rust marks links and pull quotes; sans captions and mono dates support the prose. No cards or elevation. Body content continues to use the existing family gallery, paragraph, table and media rules. Do not substitute another theme's opening just because its palette is similar.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Reportage and documentary subjects: a person at work, a place with weather in it, an object in its real context. The photograph should carry information, not mood alone.

**Treatment.** Natural-light documentary photography, film-like tonality, visible grain acceptable. True colour rather than heavy grading. Composition should survive being printed in a single column.

**Light.** Available light, whatever the scene actually has. Overcast, window light, late afternoon. Never studio-lit, never artificially separated from the background.

**Framing.** For the website opening, place this theme's source art in the 4 / 5 frame at left specified by Hero; keep its subject, medium, light and grading. Keep the complete subject visible with contain or an inner figure; do not crop evidence, objects or architecture to fill the outer region. The source-image prompt may retain its original aspect ratio; adapt its display frame in CSS. Body images retain their family framing.

**Relationship to the palette.** Muted naturals that sit comfortably on warm paper: earth, stone, foliage, denim. Saturation restrained so the rust accent stays the strongest colour on the page.

**Never:**
- Studio seamless backgrounds or cut-out objects.
- Heavy colour grading, teal-and-orange, or filter looks.
- Stock-photo staging with models performing an emotion.
- Images cropped to a square grid cell — they are sized against the measure.

**Prompt skeleton.** `documentary photograph in available overcast light, a person working in a real environment, film-like natural colour, subtle grain, wide contextual framing, muted earth palette, no studio lighting, no staging`

## Reproducing this system

1. Match this theme's Navigation, Hero and Footer patterns, geometry and reading order; check wide and narrow viewports.
2. Preserve the original palette, font families and source-image direction; gallery references supply structure only.
3. Keep the continuous serif reading column, generous leading and indented paragraphs. Rust marks links and pull quotes; sans captions and mono dates support the prose. No cards or elevation.
4. Apply body family tokens to the gallery, prose, tables or embedded workspace rather than using them to replace the website shell.
5. Keep meaningful copy, controls and focus visible at 200% zoom; never clip text to fit a reference screenshot.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for captions and UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Reference the shared local font stylesheet while working in BurnGuard; export packages include the required font files and licenses. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below the theme's existing compact breakpoint: Place the image and text in a single column with the visual lead preserved; remove the desktop offset and keep readable text order. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Keep meaningful reading order, remove desktop offsets and let labels and actions wrap. Body tables retain their own horizontal scroll region. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

## Navigation

Use `side-rail` at `side`, with `80px` minimum height and `200px` width (0px fills the available track). Use side navigation with a 200px maximum width and 80px header height. At compact widths, use compact icon/hamburger top bar and large vertical text menu. Convert the desktop rail to an overlay so content retains width.

Mobile: below --layout-bp-md, bound navigation to the viewport and put links in semantic native disclosures where needed. Side, overlay or bottom navigation returns to a compact header in normal flow; preserve focus and reading order.

Structural reference: [side-rail](https://www.navbar.gallery/navbar/big-dirty-agency). This is an original BurnGuard arrangement informed by the gallery screenshot; donor code, imagery, fonts and brand marks are not included.

## Hero

Use `split-reverse`: copy share `52%`, media at `left` in a `4 / 5` frame, minimum height `680px`, title measure `14ch`, alignment `end` and desktop offset `80px`. Preserve a complete document or image on the left and a narrow right heading, with a second substantial paragraph aligned along the lower baseline. Retain object-fit: contain for the original artwork: the whole building, document or object must remain visible. Interpret oversized/cropped reference geometry through the frame and typography, not by clipping the artwork.

Mobile: Below the theme's existing compact breakpoint: Place the image and text in a single column with the visual lead preserved; remove the desktop offset and keep readable text order. Convert the side rail into a compact top control with a native expandable navigation; release its desktop width. Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom.

Structural reference: [split-reverse](https://supahero.io/hero/habito). Reuse this theme's original imagery and typography; the reference supplies hierarchy and arrangement only.

## Footer

Use `ruled-community` with `3` desktop groups and `420px` minimum height. Reserve 420px as the desktop minimum closing height with 3 information columns or groups. Use a three-part community directory with a separate decorative baseline. Preserve real semantic links and a clear primary join action; use original local artwork.

Mobile stacks logo, actions and legal information into ruled horizontal sections; the decorative band remains at the bottom. Allow links to wrap and let the closing region grow with content.

Structural reference: [ruled-community](https://www.footer.design/sites/harvest-hall). Adapt the structural idea with this theme's own tokens and content; do not copy donor assets or brand marks.
