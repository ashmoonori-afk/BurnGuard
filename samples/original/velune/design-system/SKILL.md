---
name: velune-original-system
description: VELUNE original identity and format rules.
---

# VELUNE design system

## Identity
BurnGuard를 위한 독립 가상 브랜드. 기존 로고·문구·제품을 복제하지 않습니다.

## Visual rules
미드나이트 플럼 바탕과 쿨 민트 작품 구간. DM Serif Display·Gowun Batang 제목과 DM Sans·Pretendard 라벨, 얇은 선과 넉넉한 여백을 사용합니다. 라일락은 라벨과 가는 선에, 페일 오키드는 소재 표본에 사용합니다. 민트 면에서는 플럼 텍스트로 대비를 확보합니다. 네온과 과한 움직임을 피합니다.

## Palette
- Midnight plum #24172F: 주 배경과 민트 위 글자
- Moon white #F8F3FB: 플럼 위 본문과 제목
- Cool mint #B9E8D6: 작품 집중 면과 큰 숫자
- Pale orchid #EAE0F4: 소재 표본과 작은 보조 면
- Lilac #B89AE0: 플럼 위 라벨과 장식
밝은 면 위에는 플럼 글자만 사용합니다. 아이보리, 와인, 브라스의 따뜻한 조합으로 돌아가지 않습니다.

## Tokens / spacing
`colors_and_type.css`에 색, 타입, 간격 변수가 있습니다. 8/16/24/40/64/104px 간격. 본문 17px, 행간 1.75, 최대 읽기 폭 36em. 데스크톱 수평 패딩 4–7vw, 모바일 6vw. 600px 아래 두 열은 한 열로 전환합니다. 제목은 의미 단위로 줄바꿈하고 화면 밖으로 밀지 않습니다.

## Components
텍스트 앵커 네비게이션. 1px 선과 16×24px 패딩 CTA. FAQ/브리프는 native details/summary. 입력마다 연결된 label을 사용합니다. 색만으로 상태를 전달하지 않고, 3px focus-visible 윤곽과 충분한 터치 영역을 유지합니다.

## Copy voice
담백한 한국어와 조용한 영어 제목. 달빛의 산란, 밤의 표면, 집 안의 작은 의식을 구체적으로 관찰합니다. 입증되지 않은 최고급, 인증, 판매 실적을 쓰지 않습니다.

## Image direction
`assets/hero.png`: 플럼 받침 위 쿨 민트 오팔 초승달 조명. 오리지널 조형 이미지이며 실제 생산·납기·인증의 증거가 아닙니다. 물성이 주인공이 되도록 크롭하고 이미지에 의미 있는 alt를 작성합니다.

## Format rules
- Web: 내비게이션/푸터 제외 7개 이상 섹션. 1440px/390px 검토. 앵커와 details가 작동해야 합니다.
- Slides: 16:9, top-level `[data-slide]` 정확히 6개. 독립 제목·본문·페이지 번호. canonical runtime이 `data-active`와 body `data-deck-ready`를 관리합니다. 키보드 이동과 모든 슬라이드 인쇄를 유지합니다.
- Graphic: 1080×1350 고정 캔버스. 모바일처럼 재배치하지 않습니다. 출처 푸터 보존.
- System preview: 팔레트/타입/컴포넌트/이미지를 압축한 참고표. 랜딩 복제 금지.

## Editing / accessibility
편집 요소에 고유 `data-bg-node-id`. 번들 fonts/fonts.css와 인라인 스타일을 사용합니다. 로컬 입력은 전송·저장을 암시하지 않습니다. 추가 모션은 `prefers-reduced-motion`에서 해제합니다.

## Bundled typography
Display: DM Serif Display 400 for English and Gowun Batang 400 for Korean. Body and captions: DM Sans 400–600 for English, Pretendard 400–600 for Korean.
Load fonts/fonts.css before inline CSS. Use --font-display, --font-body and --font-caption tokens. Body 16–20px, line height 1.7–1.75; Korean headings at least 1.12, with semantic line breaks. Keep the six slides and 1080×1350 poster canvas. No network font imports or synthetic display bold/italic. The seeder copies the shared fonts directory, including SIL Open Font License notices, into every project and design system. Keep these files in exports; see fonts/README.md for provenance.
