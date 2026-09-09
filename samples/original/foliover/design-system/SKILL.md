---
name: foliover-original-design
description: Apply FOLIOVER fictional original sample identity.
---

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

## Bundled typography
Display: DM Serif Display 400 for English and Gowun Batang 400 for Korean. Body and captions: Pretendard 400–600.
Load fonts/fonts.css before inline CSS. Use --font-display, --font-body and --font-caption tokens. Body 16–20px, line height 1.7–1.75; Korean headings at least 1.12, with semantic line breaks. Keep the six slides and 1080×1350 poster canvas. No network font imports or synthetic display bold/italic. The seeder copies the shared fonts directory, including SIL Open Font License notices, into every project and design system. Keep these files in exports; see fonts/README.md for provenance.
