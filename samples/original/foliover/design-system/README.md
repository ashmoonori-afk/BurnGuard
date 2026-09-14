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
