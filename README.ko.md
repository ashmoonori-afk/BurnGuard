![BurnGuard — 로컬 AI 디자인 작업 공간](doc/images/burnguard-cover.png)

# BurnGuard

**아이디어를 말하고, 화면에서 다듬고, 파일로 가져가세요.**

BurnGuard는 슬라이드·웹사이트·그래픽을 만드는 로컬 AI 작업 공간입니다. Windows와 macOS 네이티브 앱에서 Claude Code 또는 Codex CLI를 연결하고, 모델을 선택해 미리보기 옆에서 작업합니다. **추론 강도 LOW와 바닐라 모드가 기본값**입니다. 프로젝트·첨부 원본·디자인 시스템은 내 컴퓨터에 저장하고, 생성 요청은 선택한 제공업체로 보냅니다.

[English](README.md) · [다운로드](https://github.com/ashmoonori-afk/BurnGuard/releases/latest) · [시작하기](#시작하기) · [문서](doc/README.md)

> 현재 소스 기준 안내입니다. 공개 데스크톱 릴리즈에는 일부 기능이 아직 포함되지 않을 수 있습니다. 표지는 생성 이미지이며, 작업 화면은 별도 샘플 프로필에서 촬영했습니다.

## 만들 수 있는 것

| 형식 | 작업과 결과물 |
|---|---|
| 슬라이드 | 덱 생성·편집, 문안·글꼴 점검, 발표, HTML·PDF·PPTX 내보내기 |
| 웹사이트 | 연결된 서브페이지, 공통 디자인 토큰, 페이지별 구성, HTML/CSS/JS/에셋 ZIP 및 Vercel 게시 |
| 그래픽 | 포스터·카드뉴스·배너 세트, 크기 지정, PNG·PNG 묶음·PDF 내보내기 |
| 상세페이지 | 긴 페이지와 섹션별 이미지, 섹션 경계에 맞춘 PNG·JPEG 조각 |
| 플랫폼 페이지 | 설치 가이드가 포함된 카페24 스마트디자인·아임웹 코드위젯 패키지 |
| 데이터 차트 | area·line·bar·composed·radar·pie·radial·Sankey 8종, 데이터·테마·색상 편집 |
| 3D 장면 | 번들 Three.js 오브젝트 추가·조정, AI 수정 요청 |

**내보내기 범위:** HTML·PDF는 렌더링된 슬라이드 디자인을 유지합니다. PPTX는 슬라이드 전체를 고해상도 이미지로 보존하고 원문을 발표자 노트에 넣습니다. 개별 요소는 파워포인트 객체가 아닌 HTML 작업 공간에서 편집합니다. 외부 API·서버 기능은 해당 서비스가 필요합니다. 카페24·아임웹은 가이드를 따라 직접 설치하며, 실제 고객 쇼핑몰에서의 설치 검증은 별도입니다.

## 시작하기

### 데스크톱 앱

[GitHub Releases](https://github.com/ashmoonori-afk/BurnGuard/releases/latest)에서 설치 파일을 받으세요. Windows는 설치 프로그램을 실행하거나 포터블 ZIP을 풀고 `BurnGuard.exe`를 엽니다. macOS 패키지는 미서명 배포입니다. 두 앱 모두 로컬 엔진과 릴리즈 피드 기반 업데이트를 사용합니다. [설치·패키징·업데이트 안내](doc/13-windows-updates-and-original-samples.md).

| 기능 | 준비할 것 |
|---|---|
| Windows 실행 | Windows 10/11 x64, .NET Framework 4.8, Microsoft Edge WebView2 Runtime |
| AI 생성 | 설치 및 로그인이 완료된 `claude` 또는 `codex` CLI와 사용자 계정 |
| 그래픽 생성 | 로그인된 Codex 연결. 새 창작 이미지에는 Codex 이미지 생성을 사용해요. |
| 미리보기·내보내기 렌더링 | 지원되는 Chrome·Edge 또는 Chromium. 설정에서 상태를 확인하세요. |
| 자료 첨부 | PDF·PPTX·DOCX와 지원 이미지. 문서 추출 도구 요구사항은 설정에서 확인하세요. |

AI 연결 전에도 예제와 캔버스를 살펴볼 수 있습니다. 스캔 PDF는 원본을 보존하지만 자동 OCR을 보장하지 않습니다. 바닐라 모드는 개인 플러그인·지시문을 제외하고 프로젝트 맥락을 유지합니다. CommandCode는 설정에 키를 입력해 연결하며 Claude Code CLI가 필요합니다.

### 소스에서 실행

```powershell
git clone https://github.com/ashmoonori-afk/BurnGuard.git
cd BurnGuard
bun install --frozen-lockfile
bun run scripts/dev-launcher.ts
```

CI에 고정된 Bun 1.3.14를 사용하세요. 프런트엔드는 `http://127.0.0.1:5173`, 백엔드는 `127.0.0.1:14070`입니다. Ctrl+C로 종료합니다. 포트가 사용 중이면 실행 중인 프로그램을 확인한 뒤 시작하세요.

Windows에서는 `Start-BurnGuard.bat`로 네이티브 앱을 엽니다. 최초 빌드에는 Bun과 .NET 8 SDK가 필요합니다. 소스 수정 후에는 `Start-BurnGuard.bat --rebuild`를 사용하세요. [개발·빌드 안내](doc/CONTRIBUTING.md).

## 작업 흐름

1. **시작·가져오기:** 형식과 템플릿을 고르고 자료를 올리거나 HTML 프로젝트 ZIP을 가져옵니다. 가져오면 기존 HTML·CSS의 구조를 읽고 docs 자료를 추출해 다음 AI 작업에 연결합니다. 첨부 원본은 프로젝트의 `docs/attachments`에 보존되며 웹 게시 파일에서 제외됩니다.
2. **방향 설정:** 이미지 표현 스타일 21개와 13개 분야의 용도 규칙 38개를 고르거나, 이미지마다 맞는 용도를 자동으로 적용합니다. 어투와 요청별 모델·추론 강도도 정합니다. [이미지 생성 가이드](doc/image-production.md).
3. **생성:** 작업 중 캔버스에 반영되는 결과를 확인합니다. 다시 들어와도 대화 초안과 원본 첨부를 사용할 수 있습니다.
4. **수정:** 요소를 선택해 크기·회전을 바꾸고, 고급에서 글꼴·여백을 조절합니다. 컬러 팔레트, 코멘트 기반 AI 수정, Ctrl/Cmd+휠 확대를 사용할 수 있습니다.
5. **검토·내보내기:** 품질·UX 점검과 AI 자동 수정은 권장사항입니다. 통과 여부로 내보내기·게시를 막지 않으며, 파일 안전성·요청 권한 검사는 유지합니다.

![AI 대화와 캔버스를 나란히 보여 주는 편집기](doc/images/workspace-editor.png)

### 차트

HTML 파일을 열고 확대·3D 도구 옆 **차트**를 누르세요. 8종 중 하나를 선택해 예시 데이터를 실제 값으로 바꾸고 저장합니다. 스프레드시트의 탭 구분 데이터를 붙여넣을 수 있습니다. 첫 줄은 항목·계열 이름이며, 이후 한 줄에 한 항목을 입력합니다. Sankey는 출발·도착·값 3개 열을 사용합니다.

- 저장된 차트 목록에서 각각 수정할 수 있고, Ctrl/Cmd+Z로 여러 저장 단계를 되돌리거나 저장 이력에서 시점을 선택합니다. 입력란은 자체 실행 취소를 유지하고, 그리기는 별도 이력을 사용합니다.
- 테마·단위·출처·색상을 바꾸고 고급에서 크기를 조정하세요. 복합 차트는 계열별 bar·line·area를 선택합니다.
- AI에 차트를 원하는 페이지·슬라이드 위치에 만들도록 요청하거나, 저장 후 차트 패널에서 배치·데이터 수정을 요청하세요.
- HTML에는 JSON 원본, SVG, 마우스를 올렸을 때의 값, 전체 데이터 표가 들어갑니다. 차트 스크립트나 CDN 없이 표시됩니다. PNG·PDF는 렌더링 결과이며 데이터 편집용 형식이 아닙니다.

추가 차트 라이브러리 없이 독자 구현했습니다. [데이터 형식·제약·예제](doc/charts.md).

### 디자인 시스템과 예제

**21개 스타일과 13개 용도 분야를 모두 담은 원본 이미지 예제**를 제공합니다. 스타일과 이미지의 역할을 조합한 생성 예제이며, 실제 앱 화면은 아닙니다. [전체 갤러리와 생성에 사용한 프롬프트](doc/images/image-recipes/README.md).

| 브랜드 · 제작물 | 수채화 · 학습 카드 | 인쇄 · 캠페인 |
|---|---|---|
| ![녹색과 시트러스 색상의 브랜드 제작물](doc/images/image-recipes/01-brand.png) | ![완두콩 수채화 관찰 그림](doc/images/image-recipes/08-watercolor.png) | ![주홍색 연의 인쇄 캠페인 이미지](doc/images/image-recipes/11-print.png) |
| 클레이 · 피규어 | 플래시 · 스포츠 | 픽셀 · 연속 장면 |
| ![손으로 빚은 찻주전자 캐릭터](doc/images/image-recipes/13-clay.png) | ![플래시로 포착한 배드민턴 동작](doc/images/image-recipes/17-flash.png) | ![온실 로봇의 세 장면 이야기](doc/images/image-recipes/20-pixel.png) |

**SONNEL**(사운드 오브젝트), **FOLIOVER**(소재 저널), **ODDWARD**(실험적 스튜디오), **VELUNE**(조명) 컬렉션에서 시작할 수 있습니다. 각 예제는 웹사이트·6장 슬라이드·그래픽·디자인 시스템을 포함합니다. [예제 모음](samples/original/README.md).

Google Fonts 6종과 Pretendard를 라이선스 고지와 함께 번들합니다. 스타일 패널에서 요청하면 설치된 글꼴도 불러옵니다. 로컬 글꼴 파일은 내보내기에 자동 포함되지 않습니다. [글꼴 목록](assets/fonts/README.md).

지원 파일·URL·Figma 자료를 디자인 시스템으로 가져오세요. Pinterest 무드 추출은 공개 핀 URL 최대 12개를 받고, 이미지에서 읽은 색상과 추론한 무드·대체 글꼴을 구분합니다. 가져온 시스템은 검토·게시한 뒤 프로젝트에 연결합니다.

### 웹사이트 공유

**공유 → 현재 결과물 준비**에서 Vercel 토큰과 선택적 팀 ID를 입력하고 공개 게시합니다. READY 확인 후 링크를 복사하세요. 품질검사 결과는 권장사항입니다. 토큰은 메모리에만 두고 창을 닫거나 배포가 준비되면 지웁니다. 호스팅 비용·요금제 조건·방문자 접근 권한은 Vercel 계정 설정에서 확인하세요.

## 로컬 데이터와 보안

기본 프로필은 `~/.burnguard`이며 Windows에서는 `%USERPROFILE%\.burnguard`입니다. 데이터베이스·프로젝트·디자인 시스템·설정·내보내기 캐시가 들어 있습니다. 앱 패키지를 교체할 때 이 폴더를 삭제하지 마세요.

로컬 저장과 오프라인 생성은 다릅니다. 선택한 맥락은 CLI 제공업체로 전송되며 가져오기·게시에도 네트워크를 사용합니다. 서버는 루프백에 바인딩하고 실행 권한과 Host/Origin을 검사합니다. 생성 페이지는 샌드박스로 분리합니다. 로컬 서버를 인터넷에 직접 노출하지 마세요. [보안 모델](doc/01-architecture.md#7-security-and-safety-model).

## 개발

React/Vite 프런트엔드, Bun/Hono·SQLite 백엔드, 공유 계약 패키지, Windows WinForms/WebView2·macOS AppKit/WKWebView 셸로 구성됩니다.

```powershell
bun run typecheck
bun run lint
bun run build:frontend
bun test
bun test packages/backend/tests/charts.test.ts
node scripts/qa/e2e-smoke.mjs --only creation-canvas-charts
```

테스트는 저장소 루트에서 실행해야 임시 프로필이 격리됩니다. 브라우저 QA에는 Node.js 22.13+와 Chrome·Edge가 필요합니다. Windows에서는 필요하면 `--bun <bun.exe 절대경로>`를 지정하세요. QA는 별도 프로필을 사용하며 실제 제공업체에 생성 요청을 보내지 않습니다. 커버리지는 테스트 통과와 별도 기준입니다. 공개 릴리즈 전에는 Daybreak로 최종 소스와 패키지를 보안 검토하고 차단 이슈를 해결합니다.

## 문서와 라이선스

[문서 목록](doc/README.md) · [아키텍처](doc/01-architecture.md) · [디자인 시스템](doc/05-design-system-format.md) · [생성 지침](doc/design-craft.md) · [브랜드 가이드](doc/brand-identity.md)

코드는 **Apache-2.0** 라이선스입니다. 기존 외부 구성요소 고지는 [LICENSE](LICENSE)와 [NOTICE](NOTICE), 이미지·화면 출처는 [이미지 안내](doc/images/README.md)를 참고하세요.
