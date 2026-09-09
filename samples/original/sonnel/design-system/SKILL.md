---
name: sonnel-original-design
description: Apply SONNEL fictional original sample identity.
---

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

## Bundled typography
Display: Space Grotesk 700, with Pretendard 700 for Korean headings. Body: Pretendard 400–600. Technical captions: IBM Plex Mono 400, with Pretendard for Korean.
Load fonts/fonts.css before inline CSS. Use --font-display, --font-body and --font-caption tokens. Body 16–20px, line height 1.7–1.75; Korean headings at least 1.12, with semantic line breaks. Keep the six slides and 1080×1350 poster canvas. No network font imports or synthetic display bold/italic. The seeder copies the shared fonts directory, including SIL Open Font License notices, into every project and design system. Keep these files in exports; see fonts/README.md for provenance.
