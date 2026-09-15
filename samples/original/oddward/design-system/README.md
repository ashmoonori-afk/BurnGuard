# ODDWARD design system

## Identity
BurnGuard를 위한 독립 가상 브랜드. 기존 로고·문구·제품을 복제하지 않습니다.

## Visual rules
검은 바탕, 라임 전환, 마젠타 작업 사례. 응축된 Bebas Neue 영문과 단단한 Pretendard 한글, 비대칭 7:5 그리드와 큰 빈 면을 사용합니다. 둥근 카드, 그라데이션, 장식 그림자를 피합니다.

## Tokens / spacing
`colors_and_type.css`에 색, 타입, 간격 변수가 있습니다. 8/16/24/40/64/104px 간격. 본문 17px, 행간 1.75, 최대 읽기 폭 36em. 데스크톱 수평 패딩 4–7vw, 모바일 6vw. 600px 아래 두 열은 한 열로 전환합니다. 제목은 의미 단위로 줄바꿈하고 화면 밖으로 밀지 않습니다.

## Components
텍스트 앵커 네비게이션. 1px 선과 16×24px 패딩 CTA. FAQ/브리프는 native details/summary. 입력마다 연결된 label을 사용합니다. 색만으로 상태를 전달하지 않고, 3px focus-visible 윤곽과 충분한 터치 영역을 유지합니다.

## Copy voice
짧고 직접적인 질문과 동사 중심 한국어. 영어 제목은 2–5단어. 성과와 고객명 대신 실험의 의도와 선택을 설명합니다.

## Image direction
`assets/hero.png`: 라임 받침 위 크롬 매듭과 마젠타 패널. 오리지널 조형 이미지이며 실제 생산·납기·인증의 증거가 아닙니다. 물성이 주인공이 되도록 크롭하고 이미지에 의미 있는 alt를 작성합니다.

## Format rules
- Web: 내비게이션/푸터 제외 7개 이상 섹션. 1440px/390px 검토. 앵커와 details가 작동해야 합니다.
- Slides: 16:9, top-level `[data-slide]` 정확히 6개. 독립 제목·본문·페이지 번호. canonical runtime이 `data-active`와 body `data-deck-ready`를 관리합니다. 키보드 이동과 모든 슬라이드 인쇄를 유지합니다.
- Graphic: 1080×1350 고정 캔버스. 모바일처럼 재배치하지 않습니다. 출처 푸터 보존.
- System preview: 팔레트/타입/컴포넌트/이미지를 압축한 참고표. 랜딩 복제 금지.

## Editing / accessibility
편집 요소에 고유 `data-bg-node-id`. 번들 fonts/fonts.css와 인라인 스타일을 사용합니다. 로컬 입력은 전송·저장을 암시하지 않습니다. 추가 모션은 `prefers-reduced-motion`에서 해제합니다.

## Files
- preview.html: 시각 견본
- colors_and_type.css: 재사용 토큰
- SKILL.md: 제작 규칙
- assets/hero.png: 시더가 복사하는 공용 브랜드 이미지

HTML은 인라인 CSS를 포함합니다. Deck은 canonical BurnGuard 런타임을 인라인 포함하여 오프라인 이동을 지원합니다.

## Bundled typography
Display: Bebas Neue 400 for English; Korean headings use Pretendard 700. Body and captions: Pretendard 400–600. Keep Bebas Neue tracking at 0 and never synthesize a bold face.
Load fonts/fonts.css before inline CSS. Use --font-display, --font-body and --font-caption tokens. Body 16–20px, line height 1.7–1.75; Korean headings at least 1.12, with semantic line breaks. Keep the six slides and 1080×1350 poster canvas. No network font imports or synthetic display bold/italic. The seeder copies the shared fonts directory, including SIL Open Font License notices, into every project and design system. Keep these files in exports; see fonts/README.md for provenance.


## Layout

The 12-column grid, 1320px maximum width, 52ch reading measure and 28px gutters are mandatory. Use the page margins, vertical section rhythm and 4 / 3 hero ratio from colors_and_type.css. Layout belongs to this system alongside palette and typography.

## Composition

Use giant typography beside an offset visual field with a 1:1.4 message-to-media ratio. Keep paired tiles staggered vertically on wide screens and return them to reading order on small screens.


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

- Ground: the expressive lime field with magenta panels; one magenta panel marks the emphasis.
- Cover: giant typography beside an offset visual field.
- Structure: staggered paired tiles at roughly a 1:1.4 message-to-media ratio. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: an original sculptural form, cropped so the material leads. At most one image per slide unless the request asks for a grid.
- Never: treating a generated form as production evidence, timid type, symmetrical tiling.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.56) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the expressive lime field with magenta panels; one magenta panel marks the emphasis.
- Composition: staggered paired tiles at roughly a 1:1.4 message-to-media ratio. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: an original sculptural form, cropped so the material leads.
- Never: treating a generated form as production evidence, timid type, symmetrical tiling.
