# FOLIOVER Original concept system

## Purpose / copy voice
독립 잡지의 여백과 재료 관찰의 친밀함. 질문을 건네는 한국어와 짧은 영어 편집 제목.
가상 브랜드임을 명시합니다. 성능 주장, 고객 후기, 수상, 판매 가능성을 만들지 않습니다.

## Palette / typography
Background #f4f1e8; ink #19201c; accent #32483d. Chartreuse #cfdd72 is a secondary panel with dark ink text.
Display: DM Serif Display 400 for English and Gowun Batang 400 for Korean. Body and captions: Pretendard 400–600.

## Spacing / layout
8 / 16 / 24 / 40 / 64px. Desktop gutters 4–5%; two-column asymmetric editorial grid. At 650px, stack in reading order. Straight 1px rules; no generic rounded cards.

## Components / motion
Native anchors, buttons, focus outlines, descriptive image alt. aria-pressed reading filters and a local letter preview; no external subscription submission.
No entrance animations. Respect prefers-reduced-motion. Keep controls accessible by keyboard.

## Image / formats
Use original generated assets/hero.png. Web: 7 substantive sections. Deck: 6 data-slide elements and inline existing BurnGuard deck-stage runtime. Graphic: fixed 1080×1350. Keep small text off busy images.
Always retain Original concept · BurnGuard sample.

Files: colors_and_type.css contains portable tokens; preview.html demonstrates the system. The seeder supplies assets/hero.png.

## Bundled typography
Display: DM Serif Display 400 for English and Gowun Batang 400 for Korean. Body and captions: Pretendard 400–600.
Load fonts/fonts.css before inline CSS. Use --font-display, --font-body and --font-caption tokens. Body 16–20px, line height 1.7–1.75; Korean headings at least 1.12, with semantic line breaks. Keep the six slides and 1080×1350 poster canvas. No network font imports or synthetic display bold/italic. The seeder copies the shared fonts directory, including SIL Open Font License notices, into every project and design system. Keep these files in exports; see fonts/README.md for provenance.


## Layout

The 12-column grid, 1180px maximum width, 64ch reading measure and 32px gutters are mandatory. Use the page margins, vertical section rhythm and 4 / 3 hero ratio from colors_and_type.css. Layout belongs to this system alongside palette and typography.

## Composition

Use a journal masthead, a broad material study and continuous reading columns. Alternate inset details and wide photographs with small captions; preserve editorial gutters instead of converting articles to cards.


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

- Ground: the journal paper ground; the editorial accent marks one link or lede.
- Cover: a journal masthead above a broad material study.
- Structure: continuous reading columns with inset details alternating against wide photographs and small captions. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: a material study photographed for texture. At most one image per slide unless the request asks for a grid.
- Never: converting articles into cards, closing the editorial gutters, busy collages.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.56) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the journal paper ground; the editorial accent marks one link or lede.
- Composition: continuous reading columns with inset details alternating against wide photographs and small captions. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a material study photographed for texture.
- Never: converting articles into cards, closing the editorial gutters, busy collages.
