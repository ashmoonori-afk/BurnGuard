![BurnGuard — 슬라이드, 웹사이트, 그래픽을 만드는 로컬 AI 디자인 스튜디오](doc/images/burnguard-cover.png)

# BurnGuard

<img src="doc/images/burnguard-mark.png" width="72" height="72" alt="BurnGuard 브랜드 마크" />

**아이디어를 말하고, 화면에서 다듬고, 파일로 가져가세요.**

BurnGuard는 내 컴퓨터에서 실행하는 AI 디자인 작업 공간입니다. **Claude Code 또는 Codex CLI**를 연결해 슬라이드, 웹디자인, 그래픽을 만들고, 대화와 캔버스를 오가며 수정합니다. 요청마다 모델과 추론 강도를 고를 수 있으며 **기본값은 LOW와 바닐라 모드**입니다. 프로젝트와 디자인 시스템은 로컬에 저장됩니다.

[English](README.md) · [시작하기](#시작하기) · [작업 흐름](#작업-흐름) · [개발 안내](#개발-안내) · [문서](doc/README.md)

> 표지는 AI로 생성한 콘셉트 이미지입니다. 아래 화면은 별도 로컬 샘플 프로필에서 촬영한 실제 앱 UI입니다.

## 하나의 작업 공간에서

| 만들고 싶은 것 | BurnGuard에서 하는 일 |
|---|---|
| 발표 자료 | 슬라이드 덱을 만들고 장별로 검토한 뒤 발표하거나 PDF·PPTX로 내보내요. |
| 웹디자인 | 메인과 연결된 서브페이지로 여러 페이지 웹사이트를 만들고 미리보기에서 오가요. 디자인 시스템이 연결된 랜딩 템플릿으로 시작하고 HTML을 캔버스에서 직접 수정해요. |
| 그래픽 | 가로·세로 크기를 정해 디자인하고 PNG로 내보내요. |
| 카드뉴스와 배너 세트 | 플랫폼 규격을 골라 여러 프레임을 만들고 장별로 검토한 뒤 PNG 묶음(ZIP)이나 프레임당 한 쪽짜리 PDF로 내보내요. |
| 상세페이지 | 마켓 권장 너비의 긴 페이지 하나를 만들고 섹션 경계에 맞춘 PNG·JPEG 조각을 PNG 묶음(ZIP)으로 내보내요. |
| 카페24·아임웹 페이지 | 카페24 스마트디자인 패키지나 아임웹 코드위젯 패키지로 내보내고, ZIP에 들어 있는 가이드를 따라 직접 설치해요. |
| 일관된 디자인 | 게시된 디자인 시스템의 색상·글꼴·규칙을 프로젝트에 연결해요. |
| 기존 자료에서 시작 | 템플릿을 선택하거나 PDF·PPTX를 첨부하고 참고 자료의 역할을 정해요. |
| 인터랙티브 3D | Three.js 오브젝트를 추가·조정하거나 AI에 생성을 요청하고, 미리보기에서 회전·확대해요. |

### 시작과 이어 하기를 구분한 홈

새 작업은 유형 선택에서 시작합니다. 이름·대상·목표를 입력하고 필요한 세부 설정만 펼쳐 보세요. 최근 작업, 내 프로젝트, 예제, 디자인 시스템은 각 목록에서 검색하고 다시 열 수 있습니다.

![새 작업과 최근 프로젝트를 모은 BurnGuard 홈](doc/images/workspace-home.png)

### 대화와 결과를 함께 보는 편집기

AI 대화 옆에 실제 결과물을 띄웁니다. 편집·스타일·코멘트·그리기·품질 점검을 작업에 맞춰 선택하고, 파일별로 전환하며 검토합니다. 작은 화면에서는 **작업 화면 / AI 대화**를 전환해 각각 충분한 공간에서 사용합니다.

![대화·캔버스·편집 도구를 구분한 작업 공간](doc/images/workspace-editor.png)

## 검토와 다듬기

**품질 점검 → UX 개선**에서 현재 HTML의 제목·행동·입력·링크·이미지·문단을 진단하고, 10개 자체 패턴을 검색해 AI 수정 요청으로 보낼 수 있습니다. 요청은 선택한 모델·추론 강도를 유지합니다. 모든 생성에는 자체 anti-slop 지침과 모델별 실행 지침이 적용됩니다. 정적 진단과 생성 지침이 실제 사용성이나 품질 통과를 보증하지는 않습니다. [디자인 지침과 검증 범위](doc/design-craft.md).

텍스트와 이미지를 요소별로 선택해 편집할 수 있습니다. 웹 ZIP은 프로젝트의 HTML·CSS·JavaScript·이미지·폰트를 포함하므로 압축을 풀어 정적 호스팅에 업로드하세요. 외부 API나 서버가 필요한 기능은 해당 서비스를 별도로 연결해야 합니다.

웹사이트는 **카페24 스마트디자인 패키지**(전용 레이아웃 파일, 페이지별 조각, 경로가 바뀐 에셋 트리)나 **아임웹 코드위젯 패키지**(페이지별 스코프 조각과 공통 헤더·푸터 코드)로도 내보낼 수 있습니다. 두 ZIP에는 설치 순서를 담은 한국어 가이드가 들어 있고, 앱에서도 완료된 내보내기 옆에서 같은 가이드를 볼 수 있습니다. 여러 프레임 그래픽은 프레임당 한 장씩 **PNG 묶음(ZIP)**으로, 긴 상세페이지는 섹션 경계에 맞춘 PNG·JPEG 조각으로 내보내며, 그래픽 세트는 아트보드 크기 PDF로도 인쇄할 수 있습니다. 카페24·아임웹 패키지는 실제 쇼핑몰이 아니라 공식 문서만으로 확인했으므로 설치 전에 패키지의 점검 결과를 확인하세요.

요소를 선택하면 크기·회전 손잡이가 나타납니다. 가로·세로·회전·비율은 바로 입력하고, 글꼴과 여백은 **고급**에서 조정하세요. **품질 점검** 옆 **컬러 팔레트**는 현재 HTML과 연결된 로컬 CSS의 불투명 HEX 색상을 함께 바꾸며 실행 취소를 지원합니다. **문제 자동 수정**은 검사 결과를 선택한 AI에 보내고 작업 후 다시 검사합니다. 남은 문제와 확인하지 못한 항목은 그대로 표시합니다.

새 이미지에는 Codex 이미지 생성 도구를 사용하도록 요구합니다. 도구를 사용할 수 없으면 CSS·SVG 그림으로 대체하지 않고 알립니다. 실제 위치는 검증된 지도 임베드로, 서브페이지는 브랜드를 유지하면서 목적에 맞는 별도 구성으로 만듭니다. 캔버스는 Google Maps 공식 임베드 경로를 허용합니다. NAVER 원격 JavaScript 지도는 현재 샌드박스에서 지원하지 않으며 별도의 호환 연동과 설정이 필요합니다.

### 웹사이트 공유

**공유 → 현재 결과물 준비**에서 검증된 HTML을 만든 다음 Vercel 토큰과 선택적 팀 ID를 입력하고 **Vercel에 공개 게시**를 누르세요. READY 확인 후 링크를 복사하거나 열 수 있습니다. 토큰은 메모리에만 두고 창을 닫거나 배포가 준비되면 지웁니다. Vercel 배포 보호 설정에 따라 방문자 로그인이 필요할 수 있습니다. [Vercel Hobby](https://vercel.com/docs/plans/hobby)는 개인·비상업 용도로 무료이며 상업용은 해당 요금제를 확인하세요. 실제 게시에는 사용자 계정의 토큰이 필요합니다.

## 시작하기

### 준비할 것

| 용도 | 필요한 도구 |
|---|---|
| 소스에서 실행 | Bun. 현재 저장소 검증 환경은 Bun 1.3.13과 Windows입니다. |
| AI 생성 | 설치 및 로그인이 완료된 `claude` 또는 `codex` CLI |
| PDF·PPTX·PNG 렌더링 및 미리보기 | Chromium 또는 지원되는 Chrome/Edge. 앱 설정에서 상태를 확인할 수 있습니다. |
| PDF 대화 첨부 읽기 | 앱에 포함된 Node·PDF.js를 사용하며 Python이 필요하지 않습니다. 이미지 PDF는 원본과 OCR 미실행 안내를 유지합니다. |
| PDF·PPTX 디자인 시스템 가져오기 및 PPTX 첨부 읽기 | Python 3이 필요하며, PDF 디자인 시스템 추출은 지원 버전의 `pypdf`가 추가로 필요합니다. 앱 설정에서 상태를 확인할 수 있습니다. |

AI 도구 연결 전에도 기본 예제와 캔버스를 살펴볼 수 있습니다. 실제 생성에는 선택한 CLI의 인증과 이용 조건이 적용됩니다.

그래픽 프로젝트는 Codex 로그인이 확인되어야 만들 수 있습니다. 바닐라 모드는 개인 플러그인과 지침을 제외하고 BurnGuard의 프로젝트 맥락을 전달합니다. 해당 CLI 옵션은 Codex 0.153.4와 Claude Code 2.1.261에서 확인했으며, 오래된 CLI는 업데이트가 필요할 수 있습니다. 개인 설정을 쓰려면 바닐라 모드를 직접 해제하세요.

PDF와 HTML 덱은 슬라이드의 전체 디자인을 유지합니다. 현재 PPTX 내보내기는 편집 가능한 텍스트와 슬라이드 배경을 옮기며, 이미지와 임의의 CSS 레이아웃은 포함하지 않습니다.

### Windows 앱으로 실행

**`BurnGuard-win-Setup.exe`**로 설치하거나 **`BurnGuard-win-Portable.zip`** 전체를 압축 해제하고 `BurnGuard.exe`를 여세요. Windows의 **Microsoft Edge WebView2 Runtime**을 사용하는 네이티브 창이 열립니다. 로컬 엔진은 앱과 함께 시작하며 창을 닫으면 진행 중인 작업과 함께 종료됩니다. `%USERPROFILE%\.burnguard`에 있는 기존 프로젝트를 그대로 사용합니다. 이전 브라우저 방식의 BurnGuard 서버가 켜져 있다면 먼저 종료하세요.

**0.5.0부터 자동 업데이트를 지원합니다.** 시작할 때와 6시간마다 GitHub Releases의 새 정식 버전을 확인하고 다운로드하며, 다음 실행 때 적용합니다. 하단의 **다시 시작해 적용**을 누르면 현재 작업을 중단하고 바로 재시작할 수도 있습니다. 오프라인에서도 작업 공간은 사용할 수 있습니다. 실제 업데이트 제공은 배포자가 업데이트 파일을 포함한 릴리스를 공개한 뒤부터 가능합니다.

**Windows 10/11 x64와 .NET Framework 4.8**을 대상으로 합니다. WebView2가 없다면 Microsoft의 [Evergreen Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703)을 설치하세요. 별도 Chromium 브라우저는 포함하지 않습니다. AI CLI·렌더링·자료 읽기에 필요한 도구는 위 표와 같습니다.

소스에서 앱을 만들려면 **.NET 8 SDK**를 설치한 뒤 실행하세요.

```powershell
bun install --frozen-lockfile
bun run build:windows:release
```

**`dist/releases/`**의 설치 파일·포터블 ZIP·`.nupkg`·`releases.win.json`을 함께 게시하세요. 개발용 `dist/windows-native/` 폴더에는 업데이트 설치 정보가 없습니다. 기존 0.4.0 사용자는 새 설치 파일이나 포터블 패키지로 한 번 전환해야 합니다. 현재 패키지는 서명되지 않았습니다. [빌드·게시·업데이트 안내](doc/13-windows-updates-and-original-samples.md).

### 네 가지 오리지널 샘플

Google Fonts 6종과 Pretendard를 로컬 파일로 제공합니다. DM Sans·Space Grotesk·DM Serif Display·Bebas Neue·IBM Plex Mono·고운바탕을 브랜드별로 조합하고, 한글 본문은 Pretendard를 사용합니다. 새 프로젝트와 기본 테마에 글꼴·라이선스가 포함되며, 스타일에서 선택할 수 있습니다. [폰트 구성과 출처](assets/fonts/README.md) · [타이포그래피 기본 사양](doc/05-design-system-format.md#bundled-typography-baseline)

**예시**에서 둘러보거나 **새 프로젝트 → 템플릿**에서 오리지널 디자인 시스템을 고르세요. 컬렉션마다 완성된 웹 페이지, 슬라이드 6장, 1080 × 1350 그래픽과 토큰·구성 규칙·미리보기가 있는 디자인 시스템을 제공합니다. 웹은 모두 7개 이상 섹션으로 구성했습니다. 템플릿으로 만든 복사본은 내 프로젝트에 표시되며, 수정하거나 삭제한 예시는 재실행해도 덮어쓰거나 복구하지 않습니다.

| SONNEL · 코발트 사운드 연구실 | FOLIOVER · 소재를 탐구하는 저널 |
|---|---|
| ![SONNEL 오리지널 사운드 오브젝트](samples/original/sonnel/assets/hero.png) | ![FOLIOVER 오리지널 소재 구성](samples/original/foliover/assets/hero.png) |
| ODDWARD · 실험적인 크리에이티브 스튜디오 | VELUNE · 플럼과 민트의 달빛 조명 |
| ![ODDWARD 오리지널 크롬 조각](samples/original/oddward/assets/hero.png) | ![VELUNE 오리지널 유리 조명](samples/original/velune/assets/hero.png) |

문안과 이미지 4장을 새로 만든 가상 콘셉트입니다. 실제 판매 상품이나 참고 사이트와의 제휴를 뜻하지 않습니다. [샘플 원본·이미지 프롬프트·참고 방향](samples/original/README.md).

### 소스에서 브라우저로 실행

```powershell
git clone https://github.com/ashmoonori-afk/BurnGuard.git
cd BurnGuard
bun install --frozen-lockfile
bun run scripts/dev-launcher.ts
```

이 개발용 실행기는 backend 준비 후 frontend를 시작하고 브라우저를 엽니다.

Windows에서는 `Start-BurnGuard.bat`를 더블클릭하면 네이티브 앱이 열립니다. 첫 실행은 Bun과 .NET 8 SDK로 앱을 빌드하며, 이후에는 기존 빌드를 바로 엽니다. 소스를 업데이트한 뒤에는 `Start-BurnGuard.bat --rebuild`로 다시 빌드해 여세요. 네이티브 앱을 열기 전에는 브라우저 모드 서버를 종료해 주세요.

- 앱: **http://127.0.0.1:5173**
- Backend 상태: **http://127.0.0.1:14070/api/health**
- 종료: 실행 중인 터미널에서 `Ctrl+C`

기본 포트를 다른 프로그램이 쓰고 있다면 해당 프로그램을 확인한 뒤 다시 실행하세요. 임의로 다른 프로세스를 종료하지 않습니다.

### 배포 폴더 만들기

```powershell
bun run build
```

`dist/windows/burnguard-design.exe`를 실행하면 빌드된 UI를 **http://127.0.0.1:14070**에서 제공합니다. 배포할 때는 **`dist/windows` 폴더 전체**를 옮기세요. `resources`에는 UI·마이그레이션·기본 디자인 자료·Playwright·Node와 라이선스가 함께 들어 있습니다. Chromium과 Python 상태는 별도로 확인해야 합니다.

macOS 빌드도 같은 Velopack 업데이트 채널을 사용합니다. `bun run build:mac:release`가 설치 패키지·포터블 앱·`releases.osx.json` 피드를 만들고, 패키지된 앱은 설정 → 업데이트에서 GitHub Releases의 새 버전을 확인해 적용합니다. [빌드·개발 문서](doc/CONTRIBUTING.md)와 [업데이트 문서](doc/13-windows-updates-and-original-samples.md#macos-packaging-and-updates)를 참고하세요.

## 작업 흐름

1. **새 프로젝트** — 슬라이드, 웹디자인, 그래픽, 템플릿 중 유형을 고릅니다. 목표·섹션 수를 정하고 자료를 바로 업로드합니다. 입력 내용과 첨부는 편집 가능한 대화 초안으로 전달됩니다.
   프로젝트가 생성되면 첨부 원본은 `docs/attachments`에 즉시 저장됩니다. 전송 실패·첨부 선택 해제·AI 수정·실행 취소에도 유지되며, 프로젝트 파일에서 내려받을 수 있습니다. 웹사이트 게시에는 원본을 포함하지 않습니다.
2. **AI와 만들기** — 모델과 추론 강도를 선택하고 초안을 확인한 뒤 전송합니다. 더 깊은 추론이 필요한 경우 강도를 직접 높이세요. LOW가 특정 응답 시간을 보장하지는 않습니다.
3. **결과 확인** — 생성된 파일을 열고 캔버스에서 확인합니다. 대화 초안과 첨부 역할은 세션별로 복원됩니다.
4. **직접 다듬기** — 캔버스를 이동·확대하고, 스타일 모드에서 스크롤하며 로컬 글꼴과 3D 오브젝트를 조정합니다. 저장한 코멘트를 파일·대상 맥락과 함께 AI로 보내고 대화에서 처리 결과를 확인합니다. Undo/Redo와 품질 점검도 사용할 수 있습니다.
5. **내보내기** — 프로젝트에 맞는 형식(HTML ZIP·PDF·PPTX·PNG·PNG 묶음(ZIP)·카페24/아임웹 플랫폼 패키지)을 선택합니다. 진행·취소·실패·만료 상태를 확인하고 사용 가능한 결과를 다운로드합니다. 완료된 플랫폼 패키지는 게시됨이 아니라 다운로드됨으로 표시합니다.

![유형과 필수 입력을 순서대로 안내하는 새 프로젝트 화면](doc/images/project-create.png)

## 디자인 시스템과 설정

**디자인 시스템**에서는 가져온 자료를 검토하고 색상·글꼴·미리보기를 확인한 뒤 게시합니다. 프로젝트에는 게시된 시스템을 연결합니다. URL·Figma·파일 가져오기는 지원하는 소스 형식과 인증 조건에 따라 동작합니다.

**Pinterest 무드 가져오기**는 공개 핀 URL을 최대 12개 받아 이미지 색상과 확인 가능한 메타데이터로 검토용 초안을 만듭니다. 실제 추출한 색상, 추정한 무드, 기본 글꼴을 구분합니다. 비공개 핀·보드·단축 링크는 지원하지 않으며 읽지 못한 핀은 개별 표시합니다.

**설정 및 연결**에는 사용자 정보, 기본 AI 도구, 화면 테마, Chromium, Python, Figma 연결이 모여 있습니다. 일부 도구의 상태 조회가 실패해도 다른 설정을 편집하고, 실패한 항목만 재시도할 수 있습니다.

설정에서 **CommandCode API 키**를 저장·삭제하면 지원하는 Claude 모델을 [CommandCode 제공자 API](https://commandcode.ai/docs/provider)로 연결할 수 있습니다. 설치된 Claude Code CLI는 계속 필요합니다. 저장한 키는 설정 조회 API로 반환하지 않으며 실제 실행에는 유효한 키와 계정이 필요합니다. 로컬 글꼴 목록은 버튼을 누르면 브라우저 권한 또는 Windows 글꼴 목록으로 불러옵니다. 글꼴 파일을 업로드하거나 내보낸 결과에 포함하지는 않습니다.

## 데이터와 네트워크

기본 데이터 위치는 `~/.burnguard/`입니다. Windows에서는 `%USERPROFILE%\.burnguard\`에 해당합니다.

```text
.burnguard/
├── config.json          # 사용자 설정
├── burnguard.db         # 프로젝트·대화·이벤트·작업 상태
├── data/
│   ├── projects/        # 프로젝트 파일
│   └── systems/         # 디자인 시스템
├── cache/exports/       # 내보낸 결과
└── logs/
```

로컬 저장이 모든 처리가 오프라인이라는 뜻은 아닙니다. AI 생성 시 프롬프트와 선택한 맥락은 CLI가 사용하는 제공자에게 전송됩니다. 웹·Figma 가져오기와 필요한 도구 설치도 네트워크를 사용합니다. 민감한 자료를 첨부하기 전 사용 중인 제공자의 정책을 확인하세요.

앱은 loopback에 연결되고 API 실행 권한과 Host/Origin을 검사합니다. 캔버스는 생성물이 다른 호스트로 접근하지 못하도록 Content-Security-Policy가 적용된 별도 sandbox에서 실행되며, 프로젝트 원본 파일은 최상위 페이지로 렌더링되지 않습니다. 같은 컴퓨터의 다른 프로세스와 사용자는 신뢰 대상이므로 공유 호스트나 원격에서 접근 가능한 호스트에서는 실행하지 말고, 이 서버를 인터넷에 직접 공개하지 마세요. [보안 모델](doc/01-architecture.md#7-security-and-safety-model)을 참고하세요.

## 개발 안내

Bun 모노레포이며 새 상태 관리나 디자인 라이브러리 없이 기존 React·React Query·Radix·Tailwind를 사용합니다.

| 경로 | 역할 |
|---|---|
| `packages/frontend` | React/Vite UI, 대화·캔버스·디자인 시스템·설정 |
| `packages/backend` | Hono, SQLite, CLI 실행, 파일 복구, 추출·내보내기 |
| `packages/shared` | 버전이 지정된 API·이벤트 계약과 파서 |
| `packages/desktop-windows` | Windows x64 WinForms/WebView2 창과 로컬 엔진 수명 관리 |
| `scripts` | 실행·빌드·격리된 QA |

```powershell
bun run typecheck
bun run build:frontend
bun run test
bun run test:coverage
bun run lint
node scripts/qa/e2e-smoke.mjs
```

테스트는 저장소 루트에서 실행합니다. preload가 독립된 임시 프로필과 정식 마이그레이션 DB를 준비합니다. 브라우저 QA에는 Node.js 22.13 이상이 필요하며, 사용자 작업과 분리된 샘플 프로필을 사용하고 외부 모델 요청을 보내지 않습니다. npm의 Windows Bun 명령 shim을 사용하는 경우 브라우저 QA에 `--bun <bun.exe 절대경로>`를 전달하세요. 브라우저를 많이 쓰는 검증은 순차 실행하는 편이 안정적입니다.

`lint`는 `git diff --check`입니다. 테스트 통과와 파일별 80% coverage 기준 통과는 별개입니다. 기존 검토에서는 전체 테스트가 통과했지만 파일별 coverage 기준은 미달했으며, 이 수치를 새 UI의 검증 결과로 재사용하지 않습니다.

## 현재 범위

- 실행 중인 로컬 CLI를 활용하는 단일 사용자 작업 공간입니다. 클라우드 공동 편집·호스팅·자동 배포 도구는 아닙니다. 카페24·아임웹 플랫폼 패키지는 패키지에 포함된 가이드를 따라 사용자가 직접 설치하며, BurnGuard가 해당 플랫폼에 로그인하거나 대신 업로드하지 않습니다.
- 연구 카탈로그는 생성 시 참고할 출처와 한계를 제공합니다. 별도의 연구 관리 UI와 모든 자료에 대한 품질 보장은 제공하지 않습니다. [연구 문서](doc/research.md)
- 외부 제공자·Figma 계정, 모든 사용자 문서, macOS, Narrator와 전체 접근성 기준의 실측은 로컬 회귀 테스트와 별도로 확인해야 합니다.
- 파일별 coverage 미달 및 상세 검증 범위는 [이전 검토](doc/09-review-remediation-2026-09-08.md), [UI 재설계](doc/10-ui-redesign-2026-09-09.md), [생성·캔버스 개선 기록](doc/11-creation-tools-and-canvas-2026-09-09.md)에 구분해 기록합니다.

## 문서와 라이선스

[문서 목차](doc/README.md) · [기여 안내](doc/CONTRIBUTING.md) · [아키텍처](doc/01-architecture.md) · [데이터 모델](doc/02-data-model.md) · [디자인 시스템 형식](doc/05-design-system-format.md)

코드는 **Apache-2.0** 라이선스로 제공됩니다. [LICENSE](LICENSE)와 [NOTICE](NOTICE)에서 외부 자료의 출처·라이선스를 확인하세요. 이미지의 생성 기록과 실제 화면 촬영 범위는 [이미지 안내](doc/images/README.md)에 있습니다.

생성한 B 마크와 색상·사용 규칙은 [브랜드 가이드](doc/brand-identity.md)에 정리했습니다.
