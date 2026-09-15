# SONNEL Original concept system

## Purpose / copy voice
차가운 합성음 연구실의 명료함과 촉각 인터페이스의 정밀함. 짧은 신호 주석과 구체적인 한국어 설명.
가상 브랜드임을 명시합니다. 성능 주장, 고객 후기, 수상, 판매 가능성을 만들지 않습니다.

## Palette / typography
Background #EDF4FF; ink #08182E; accent #244DFF. Cobalt marks signal and controls; ice blue is the field, steel #CDD9EE divides surfaces, and deep navy carries text. On navy panels, signal readouts use ice blue for contrast.
Display: Space Grotesk 700, with Pretendard 700 for Korean headings. Body: Pretendard 400–600. Technical captions: IBM Plex Mono 400, with Pretendard for Korean.

## Spacing / layout
8 / 16 / 24 / 40 / 64px. Desktop gutters 4–5%; two-column ruled technical grid. At 650px, stack in reading order. Straight 1px rules; no generic rounded cards.

## Components / motion
Native anchors, buttons, focus outlines, descriptive image alt. Range slider and aria-pressed modes are visual controls only, not audio playback.
No entrance animations. Respect prefers-reduced-motion. Keep controls accessible by keyboard.

## Image / formats
Use original generated assets/hero.png. Web: 7 substantive sections. Deck: 6 data-slide elements and inline existing BurnGuard deck-stage runtime. Graphic: fixed 1080×1350. Keep small text off busy images.
Always retain Original concept · BurnGuard sample.

Files: colors_and_type.css contains portable tokens; preview.html demonstrates the system. The seeder supplies assets/hero.png.

## Bundled typography
Display: Space Grotesk 700, with Pretendard 700 for Korean headings. Body: Pretendard 400–600. Technical captions: IBM Plex Mono 400, with Pretendard for Korean.
Load fonts/fonts.css before inline CSS. Use --font-display, --font-body and --font-caption tokens. Body 16–20px, line height 1.7–1.75; Korean headings at least 1.12, with semantic line breaks. Keep the six slides and 1080×1350 poster canvas. No network font imports or synthetic display bold/italic. The seeder copies the shared fonts directory, including SIL Open Font License notices, into every project and design system. Keep these files in exports; see fonts/README.md for provenance.


## Layout

The 12-column grid, 1200px maximum width, 58ch reading measure and 28px gutters are mandatory. Use the page margins, vertical section rhythm and 16 / 10 hero ratio from colors_and_type.css. Layout belongs to this system alongside palette and typography.

## Composition

Pair tactile product photography with a concise five-column message. Follow with material details, a broad product feature and aligned specifications. Keep the product image dominant and preserve open gutters.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (72px), and `--slide-type-caption` (24px) is the smallest type on any slide.

- Ground: the cobalt synthesis-lab ground; cobalt marks one control or value.
- Cover: tactile product photography beside a concise message column.
- Structure: material details, one broad product feature, then aligned specifications; keep the gutters open. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: tactile product photography where the material leads. At most one image per slide unless the request asks for a grid.
- Never: closing the open gutters, decorative filler, a second accent hue.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.56) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the cobalt synthesis-lab ground; cobalt marks one control or value.
- Composition: material details, one broad product feature, then aligned specifications; keep the gutters open. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: tactile product photography where the material leads.
- Never: closing the open gutters, decorative filler, a second accent hue.
