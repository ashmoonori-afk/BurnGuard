<p align="right">
  <a href="README.md"><img alt="English README" src="https://img.shields.io/badge/English-README-004fff?style=for-the-badge" /></a>
</p>

# BurnGuard Design

BurnGuard Design는 로컬 우선 AI 디자인 워크스페이스입니다. 이미 설치되어 있는 `claude`, `codex` CLI를 채팅과 캔버스 워크플로로 감싸서 prototype과 slide deck을 만들고, 프로젝트 파일과 디자인 시스템, export 결과물을 전부 내 머신에 둡니다.

버전: `0.4.0`. 라이선스: [Apache-2.0](LICENSE).

## 어떤 문제를 푸는가

코딩 에이전트로 랜딩 페이지나 피치 덱을 뽑는 것 자체는 쉽습니다. 어려운 건 *일관되고 근거 있는* 결과입니다. 보통 세 군데서 무너집니다.

1. 턴마다 새 팔레트, 새 타입 스케일, 새 레이아웃을 창작합니다.
2. 디자인 조언의 출처가 불분명합니다. 어떤 게 접근성 필수 제약이고 어떤 게 특정 벤더의 취향인지 구분되지 않습니다.
3. 컨텍스트로 넣은 브랜드 덱, PDF, 내부 사이트가 남의 테넌트에 올라갑니다.

BurnGuard는 디자인 시스템을 주요 입력으로 삼고 모든 턴에서 토큰을 참조합니다. 리서치 카탈로그의 규칙에는 출처, 권위 등급, 신뢰도와 한계가 붙습니다. 백엔드는 `127.0.0.1`에서 실행하고 데이터는 `~/.burnguard/`에 저장합니다. 생성할 때는 로컬 CLI에 설정된 제공자에게 프롬프트와 선택된 문맥을 전송하며, 웹사이트 추출과 Figma 연동도 요청한 대상에 네트워크 연결을 사용합니다.

## 아키텍처

Bun 모노레포이고, 워크스페이스 패키지 셋에 스크립트가 붙습니다.

| 경로 | 역할 |
|---|---|
| `packages/backend` | Bun 위의 Hono HTTP 서버, SQLite 영속화, CLI 어댑터, 추출, export, 리서치 |
| `packages/frontend` | React 18 + Vite SPA (홈, 프로젝트, 디자인 시스템, 설정) |
| `packages/shared` | 양쪽이 공유하는 버전 계약과 파서 |
| `scripts/` | 빌드, 개발 런처, QA 하네스 진입점 |

런타임 구조:

- 백엔드는 기본적으로 `127.0.0.1:14070`에서 대기합니다. `BG_PORT`로 덮어쓸 수 있고, `BG_SCAN_PORT=1`이면 14070부터 14170까지 탐색합니다.
- `/api/health`를 제외한 모든 `/api` 라우트는 실행 단위 capability로 보호됩니다. `GET /api/bootstrap`이 동일 출처 호출자에게 `HttpOnly` 쿠키와 JSON 본문으로 capability를 내주고, 변경 요청은 추가로 일치하는 `Origin` 헤더와 `X-Burnguard-Capability` 헤더를 요구합니다. `Host`가 맞지 않으면 `421`입니다.
- 프로젝트, 세션, 이벤트, 코멘트, export, 카탈로그, 학습, 리서치의 원본은 SQLite입니다. 마이그레이션은 `packages/backend/src/db/migrations/`에 있고 bootstrap에서 실행되며, 리서치 상태는 `0010_research.sql`에서 정의됩니다.
- 프론트엔드는 `/api`로만 백엔드와 통신하고, 캔버스는 sandbox iframe에서 프로젝트 아티팩트를 렌더링합니다.

디스크 레이아웃:

```text
~/.burnguard/
  config.json          # 로컬 설정, 저장할 때마다 chmod 600
  burnguard.db         # SQLite 데이터베이스
  data/
    projects/
    systems/
  cache/
    exports/
  logs/
```

## 한 턴의 전체 흐름

1. 채팅 창에 메시지를 보냅니다. 백엔드가 사용자 이벤트를 기록하고 프로젝트 트리를 체크포인트로 스냅샷합니다.
2. `packages/backend/src/harness/prompt-builder.ts`가 프롬프트를 결정적으로 조립합니다. 프로젝트 정보, 프로젝트 타입 skill, 버전이 붙은 디자인 브리프, 디자인 시스템 토큰, 열려 있는 코멘트 핀, 첨부 요약, 필요 시 reference-layout 계약과 엔트리포인트 구조 맵, 그리고 `<burnguard-research-context-v1>` 블록입니다.
3. 어댑터(`adapters/claude-code` 또는 `adapters/codex`)가 CLI를 실행해 stdout을 스트리밍하고, 채팅 델타 / 툴 시작·종료 / 파일 변경 / 사용량 / 상태 같은 타입 이벤트로 정규화합니다.
4. 이벤트는 SQLite에 순번과 함께 기록되고 SSE(`GET /api/sessions/:id/stream`)로 전달됩니다. 감시 중인 파일이 바뀌면 캔버스 iframe이 다시 로드됩니다.
5. 캔버스에서 검토하고, 코멘트 핀을 찍고, GUI로 요소를 패치하고, 턴을 되돌리거나 export합니다.

리서치 컨텍스트 블록은 매 턴 `services/research-purpose.ts`가 만듭니다. 프로젝트 타입과 요청 문장으로 라우팅하고, 카탈로그 규칙을 선택한 뒤 routing, rules, advice, output profile, precedence와 함께 `assembly: "fixed_captured_state"` 표시를 내보냅니다. 실시간 조회가 아니라 고정된 스냅샷이라는 뜻입니다.

## 리서치 카탈로그

저장소에는 `packages/backend/src/research-data/` 아래에 근거가 붙은 카탈로그가 들어 있습니다. 생성과 리뷰를 위한 참조 데이터이지, 접근성 테스트나 법적 검토를 대체하지 않습니다. 작성 규칙은 `doc/research.md`에 있습니다.

### 출처 원장(source ledger)

`sources.json`에는 45개의 `S-***` 레코드가 있습니다. 각각 URL(https만 허용), 수집 날짜, 소유자 또는 제목, 정렬된 태그, 20단어 미만의 재서술, `license_usage` 메모, 신뢰도, 한계를 갖습니다. 벤더 자산, 폰트, 템플릿, 컴포넌트 코드는 이 저장소로 복사되지 않습니다. 출처를 가리키는 재서술된 원칙만 담깁니다.

### 공통 규칙과 목적 참조 세트

의도적으로 분리된 두 개념입니다.

- **공통 규칙**(`common-rules.json`, 15개 `CR-***`)은 재사용 가능하며 원장 ID를 인용합니다. 각 규칙은 `authority_class`를 선언합니다.
  - `normative_web_constraint`는 WCAG 자료를 재서술합니다. 한계 필드가 기준 레벨, 범위, 예외를 보존합니다. 그 단서를 떼어내 규칙을 더 강하게 만들면 안 됩니다.
  - `sampled_system_guidance`는 공개 디자인 시스템의 한정된 표본에서 반복되는 내용을 종합한 것입니다. 반복은 지침을 뒷받침할 뿐 보편 법칙이 아닙니다. 구체적인 간격 값, 그리드, 폰트, 색, 브레이크포인트, radius, 벤더 토큰 이름은 시스템 고유로 남습니다.
- **목적 참조 세트**(`purpose-references.json`)는 열 개의 prompt 선택자 레코드입니다. `deck.company`, `deck.pitch`, `deck.report`, `deck.sales`, `deck.training`, `prototype.dashboard`, `prototype.diagram`, `prototype.editorial`, `prototype.landing`, `prototype.sandbox`. purpose는 네 개 축(`project_type`, `request_intent`, `creation_mode`, `fallback`) 위의 선택자이지 새 프로젝트 타입이 아닙니다. 각 purpose는 고유 guidance, 끌어오는 공통 규칙, 인용, 신뢰도, 한계를 갖습니다. deck 레코드는 medium 신뢰도입니다. 출처가 뒷받침하는 건 범위가 있는 전달 원칙이지 각 deck 종류의 보편 서사가 아닙니다.

두 등급이 함께 적용되면 규범적 제약이 이깁니다. 표본 기반 지침은 구현 패턴을 고를 수는 있어도 규범적 제약을 약화시킬 수 없습니다. 요청이 어떤 선택자와도 맞지 않으면 공통 베이스라인(`CR-001`~`CR-005`, `CR-008`, `CR-009`)으로 폴백하고 `request_intent: "unspecified"`로 보고합니다.

카탈로그 로더(`services/research-catalog.ts`)는 엄격합니다. 알 수 없는 키, 잘못된 schema version, https가 아닌 URL, 형식에 맞지 않는 ID, 정렬되지 않거나 중복된 ID, 해소되지 않는 인용, 지원되는 열 개 prompt purpose와 정확히 일치하지 않는 집합을 모두 거부합니다.

영속화되는 대량 리서치 계약은 더 좁습니다. 다섯 prototype purpose와 `deck.pitch`만 허용합니다. 새로 추가된 네 deck 선택자는 prompt catalog 전용이며 영속 리서치 결과의 purpose로는 허용되지 않습니다.

### 우선순위와 오버라이드

프롬프트 컨텍스트는 우선순위를 `["research", "design_system", "project", "user_request"]`로 명시합니다. 레이어 순서로 읽으면 됩니다. 리서치가 베이스라인이고, 연결된 디자인 시스템이 그 위를 덮고, 프로젝트 결정이 다시 그 위를, 사용자의 요청이 최종 결정권을 갖습니다. 레이어 해석은 `resolveResearchRuleLayers`(`services/research-selection.ts`)에 있습니다.

- 같은 axis에서는 뒤 레이어가 앞 레이어를 덮고, 규칙은 내용을 다시 쓰는 대신 ID로 다른 규칙을 참조할 수 있습니다.
- 모든 오버라이드는 승자 규칙 ID와 덮인 규칙 ID들을 담은 `LayerConflict`로 기록됩니다. 조용히 사라지는 규칙은 없습니다.
- 중복 규칙 ID, 해소 불가한 참조, 참조 순환은 전부 에러입니다.

오버라이드가 일어나도 두 가지는 유지됩니다. 규범적 접근성 한계는 규칙 문구에 계속 붙어 있고, 충돌은 평균값으로 뭉개지지 않고 그대로 보존됩니다.

## 경계가 있는 대량 리서치

기본 카탈로그와 별개로, 백엔드는 구조화된 출처를 대상으로 경계가 정해진 리서치 작업을 실행하고 인용이 붙은 결과 집합을 영속화할 수 있습니다. 전체 수명주기가 내구적이고, 취소 가능하며, 재시작에 안전합니다.

### 계약

`packages/shared/src/research-contract.ts`가 버전이 붙은 요청을 정의합니다. 한계값은 권고가 아니라 검증 대상입니다.

| 한계값 | 허용 범위 |
|---|---|
| `concurrency` | 1 ~ 8 |
| `per_source_timeout_ms` | 1000 ~ 120000 |
| `max_sources` | 1 ~ 200 |
| `max_bytes_per_source` | 1 ~ 10000000 |

`purposes`는 정렬되고 중복이 없어야 하며 지원되는 여섯 persisted-research purpose에서만 골라야 합니다. `mode`는 `fixture` 또는 `live`이고, `fixture_id`는 fixture 모드일 때만 존재해야 합니다. live 모드에서는 모든 출처가 `web` 또는 `repository` 종류의 `https` URL이어야 하고 자격 증명이 URL에 포함되면 안 됩니다.

### 라우트

| 라우트 | 동작 |
|---|---|
| `POST /api/research/dry-run` | 요청을 계획해 ordinal, 정규화된 locator, 중복 매핑, canonical 출처 수, digest를 돌려줍니다. DB 쓰기도 네트워크 호출도 없습니다. |
| `POST /api/research/runs` | `request_key` 기준의 멱등 시작. `202`와 run 레코드를 반환합니다. 같은 키로 다시 호출하면 새 run이 아니라 기존 run이 돌아옵니다. |
| `GET /api/research/runs/:id` | run 상태, 출처별 상태, 진행 카운터, 그리고 결과가 생겼으면 결과. |
| `POST /api/research/runs/:id/cancel` | 취소 의도를 먼저 영속화한 뒤 진행 중인 작업을 중단합니다. 본문은 `{}`여야 합니다. |

### 실행

`services/research-orchestrator.ts`가 출처를 계획하고 정규화된 locator 기준으로 중복을 제거한 뒤(해시 제거, 끝 슬래시 정규화, NFC 적용), canonical 출처를 `concurrency` 크기의 워커 풀로 처리합니다. 각 출처는 자체 타임아웃과 abort 신호를 갖습니다. 네트워크 로딩은 `services/research-source-loader.ts`를 거치며, 사설·루프백 호스트를 차단하고, 리다이렉트를 거부하고, `application/json`만 허용하며, 바이트 상한을 `Content-Length`와 스트리밍 양쪽에서 강제합니다.

모든 단계에 digest가 붙습니다. canonical JSON에 대한 `sha256`으로 요청 digest, 출처별 content digest, finding digest, canonical 출처 결과 전체에 대한 evidence set digest, 결과 digest가 만들어집니다. 워커 출력은 `source_id`와 `content_digest`가 자신이 설명한다고 주장하는 출처와 일치할 때만 채택됩니다.

합성 결과도 검증을 통과해야 합니다. `requireUsable`은 run ID, 요청 digest, evidence digest, 출처 요약을 잘못 보고하거나, 공통 규칙이 하나도 없거나, 요청된 purpose가 비어 있거나, 성공하지 않은 출처를 인용하거나, 같은 axis에 서로 다른 지시를 내면서 충돌 설명을 남기지 않은 결과를 거부합니다.

### 출처 추적, 신뢰도, 충돌

결과의 모든 규칙은 `source_ids`를 갖고, 모든 ID는 같은 run에 속하면서 `succeeded`에 도달한 출처 행으로 해소됩니다. 신뢰도는 런타임 규칙에서는 수치이고 카탈로그 규칙에서는 `high | medium | low` 등급입니다. 임계 아래는 조용히 버리지 않고 `low_confidence`로 표시합니다. 충돌은 결과에 남고, 프롬프트 컨텍스트를 만들 때 선택된 purpose에 걸린 것만 걸러냅니다. 영속화된 결과가 재검증에 실패하면 `selectResearchPromptContext`가 그 run을 `corrupt`로 격리하고 다음 사용 가능한 run으로 넘어갑니다. 검증되지 않은 규칙을 그대로 쓰지 않습니다.

### 실패, 부분 성공, 취소, 재시작

- **출처 단위 실패**는 타입으로 구분됩니다. `source_timeout`, `fetch_failed`, `malformed_source`, `worker_failed`, `invalid_worker_output`, `user_cancelled`, `persisted_data_corrupt`.
- **부분 성공**은 정식 결과입니다. canonical 출처 중 하나 이상이 성공하고 하나 이상이 실패하면 run은 `partial`, `stop_reason: "partial_sources"`로 끝나고 결과는 여전히 사용 가능합니다.
- **사용 가능한 결과 없음**: 성공이 0이면 `failed` + `no_usable_result`입니다. 오케스트레이션 중 예외가 나면 `failed` + `orchestration_failed`입니다.
- **취소**는 abort 전에 의도를 먼저 영속화합니다. 그래서 그 사이에 프로세스가 죽어도 살아 있는 것처럼 보이는 run이 남지 않습니다. 아직 대기 중이거나 실행 중이던 출처는 `user_cancelled`와 함께 `cancelled`가 됩니다.
- **재시작** 시 bootstrap에서 `reconcileResearchState`가 돕니다. 영속화된 모든 run과 출처를 다시 파싱하고 digest를 재계산하며, 취소 요청이 있던 run을 종결하고, 중단된 작업을 `recovering`을 거쳐 `pending`으로 되돌려 재큐잉하고, 출처가 이미 끝난 run은 합성으로 마무리하고, 검증에 실패한 행은 신뢰하는 대신 `corrupt`로 격리합니다.
- **오프라인**은 fixture 모드로 완전히 지원됩니다. 네트워크를 전혀 건드리지 않습니다. live 모드에서 네트워크 실패는 해당 출처의 `fetch_failed`로 드러나고 나머지 run은 계속 진행됩니다.

## 설치와 설정

사전 준비:

- [Bun](https://bun.sh)
- Node.js (Vite와 Playwright CLI가 사용)
- `PATH` 위에 에이전트 CLI 하나 이상: `claude` 또는 `codex`
- PDF / PPTX export를 쓰려면 Chromium. 설정 화면에서 설치하거나 `npx playwright install chromium`
- PDF / PPTX 인제스트에만 필요한 Python 3.10+ 와 `pypdf`. [`packages/backend/requirements.txt`](packages/backend/requirements.txt) 참고, 또는 설정 화면의 원클릭 설치 사용

BurnGuard 전용 API 키도, 키 파일도, 시크릿 입력 폼도 없습니다. 이미 로그인한 CLI의 인증 상태를 그대로 재사용합니다. Figma 개인 액세스 토큰을 설정하면 `~/.burnguard/config.json`에만 저장되고 API로 다시 노출되지 않습니다.

```sh
bun install --frozen-lockfile
bun run typecheck
```

두 프로세스를 함께 실행:

```sh
bun run dev
```

따로 실행:

```sh
bun run dev:backend
bun run dev:frontend
```

터미널을 열기 싫은 경우를 위한 더블클릭 런처도 있습니다. Windows는 `Start-BurnGuard.bat`, macOS는 `Start-BurnGuard.command`입니다. 둘 다 `scripts/dev-launcher.ts`를 호출해서 백엔드 헬스체크를 통과한 뒤 Vite를 띄우고, 종료 시 자식 프로세스를 함께 정리합니다. `BG_LAUNCHER_NO_OPEN=1`을 주면 브라우저를 자동으로 열지 않습니다.

빌드:

```sh
bun run build          # 프론트엔드 번들 + 백엔드 바이너리
bun run build:frontend
bun run build:mac      # 디스크 이미지는 build:mac:dmg
```

Windows에서는 `dist/windows/` 폴더 전체를 배포합니다. `burnguard-design.exe`와 나란히 있는 `resources/`에 프런트엔드, 마이그레이션, 샘플 디자인 시스템, CSS worker, Playwright와 브라우저 렌더링용 Node가 들어갑니다. 패키징은 해당 Node 버전의 라이선스를 받아 `.bun/`에 캐시하고 `resources/node/LICENSE`에 포함합니다. 저장소와 다른 위치, 공백·한글이 있는 경로에서도 실행할 수 있습니다. Chromium/Chrome/Edge와 사용할 에이전트 CLI는 실행 환경에 필요합니다.

## 사용법

### UI

SPA 라우트는 네 개입니다. `/`(홈), `/projects/:id`, `/systems/:id`, `/settings`.

- **홈**은 프로젝트와 디자인 시스템 목록, 샘플 복원과 프롬프트 샘플 바로가기를 제공합니다.
- **프로젝트**는 채팅 창과 캔버스입니다. 캔버스에는 Select, Comment, Edit, Tweaks, Draw, Present 오버레이, GUI 패치용 1단계 되돌리기, 아티팩트 로드 실패 시 재시도 버튼이 있는 인라인 오류 오버레이가 있습니다. 사용자 메시지마다 턴 이전 스냅샷으로 되돌릴 수 있습니다.
- **디자인 시스템** 화면은 가져온 번들과 preview 페이지, 추출 시 주의사항을 보여줍니다.
- **설정**에서는 백엔드 선택, Chromium / Python 설치 상태, 인터럽트 지연, 채팅 컨텍스트 모드, Figma 액세스를 다룹니다.

리서치는 아직 전용 UI가 없습니다. 두 경로로 닿습니다. 프롬프트 빌더가 매 턴 주입하는 리서치 컨텍스트 블록, 그리고 아래 HTTP API입니다.

### API

변경 요청에는 실행 capability가 필요합니다. 동일 출처 호출로 한 번 받아옵니다.

```sh
BG=http://127.0.0.1:14070
CAP=$(curl -s -H "Origin: $BG" $BG/api/bootstrap | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["capability"])')
```

DB와 네트워크를 건드리지 않고 요청을 계획:

```sh
curl -s -X POST $BG/api/research/dry-run \
  -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" \
  -H 'content-type: application/json' \
  -d '{"schema_version":1,"purposes":["prototype.landing"],
       "sources":[{"kind":"fixture","locator":"fixture-a"},{"kind":"fixture","locator":"fixture-a"}],
       "limits":{"concurrency":2,"per_source_timeout_ms":10000,"max_sources":10,"max_bytes_per_source":262144},
       "orchestrator_version":"research-v1","mode":"fixture","fixture_id":"mass-research-v1"}'
```

이 계획은 두 번째 출처를 `"duplicate_of": 0`으로, canonical 출처 수를 `"canonical_sources": 1`로 보고합니다.

fixture run을 시작하고 다시 읽기:

```sh
curl -s -X POST $BG/api/research/runs \
  -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" \
  -H 'content-type: application/json' \
  -d '{"request_key":"demo-1","request":{"schema_version":1,"purposes":["prototype.landing"],
       "sources":[{"kind":"fixture","locator":"fixture-a"},{"kind":"fixture","locator":"fixture-b"}],
       "limits":{"concurrency":2,"per_source_timeout_ms":10000,"max_sources":10,"max_bytes_per_source":262144},
       "orchestrator_version":"research-v1","mode":"fixture","fixture_id":"mass-research-v1"}}'

curl -s -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" $BG/api/research/runs/<id>
curl -s -X POST -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" \
  -H 'content-type: application/json' -d '{}' $BG/api/research/runs/<id>/cancel
```

완료된 fixture run은 `status: "completed"`, 진행 카운터, 출처별 상태, 그리고 같은 run의 출처 행 ID를 인용하는 규칙이 담긴 결과를 돌려줍니다.

### 라이브 구조화 출처

`mode`를 `live`로 바꾸고 `fixture_id`를 `null`로 두고 `web` 또는 `repository` 종류의 `https` 출처를 넘깁니다. 라이브 출처는 `application/json`으로 `{ "schema_version": 1, "title": string, "claims": [{ "axis": string, "text": string }] }` 형태를 제공해야 하며 claim이 최소 하나 있어야 합니다. 그 외는 `malformed_source`입니다. 리다이렉트, 사설 호스트, 크기 초과 본문, JSON이 아닌 content type은 파싱 전에 거부됩니다.

### fixture와 dry-run QA

`scripts/qa/mass-research-dry-run.ts`는 서버 없이 결정적 receipt를 만듭니다.

```sh
bun run scripts/qa/mass-research-dry-run.ts \
  --fixture scripts/qa/fixtures/mass-research.json --purpose prototype \
  --evidence-dir /tmp/bg-research-happy

bun run scripts/qa/mass-research-dry-run.ts \
  --fixture scripts/qa/fixtures/mass-research-adversarial.json --scenario failures \
  --evidence-dir /tmp/bg-research-failures
```

정상 receipt에는 digest, 선택된 공통 규칙과 purpose 규칙, 규칙별 출처 추적, 신뢰도가 붙은 규칙별 설명이 담깁니다. 적대적 fixture는 타임아웃, fetch 실패, malformed 중복, 부분 워커 실패, 취소, 재시작 복구, 오버라이드 우선순위, 알 수 없는 purpose라는 여덟 가지 제품 기반 QA 케이스를 정의합니다. 해당 동작은 제품 기반 CLI가 실행하고, 재시작 복구는 production bootstrap 조정 경로를 통해 실행됩니다. 둘 다 `receipt.json`을 원자적으로 쓰고, 케이스가 하나라도 실패하면 0이 아닌 코드로 종료합니다.

## 검증 명령

```sh
bun run typecheck                                  # 워크스페이스 전체 tsc --build
bun run build:frontend                             # 정적 서빙 테스트 전에 필요
bun run test                                      # 전체 스위트, 기본 제한시간 30초 명시
bun run test:coverage                              # 별도 파일별 80% 커버리지 기준
bun run lint                                       # 공백 오류 검사
node scripts/qa/e2e-smoke.mjs                       # 실제 브라우저, 격리된 프로필
node scripts/qa/package-smoke.mjs                   # Windows 배포본을 별도 위치에서 실행
bun test packages/backend/tests/research-catalog.test.ts   # 카탈로그 검증기 단독
```

테스트는 저장소 루트에서 실행합니다. preload가 매번 임시 `BG_APP_ROOT`와 정식 마이그레이션을 적용한 DB를 만들고, 상속된 프로필 경로를 덮어써 사용자 데이터 접근을 막습니다. 종료 시 자신이 만든 테스트 폴더만 정리하며, 격리 없이 실행하는 테스트 프로세스는 거절합니다. 단위 테스트 통과와 파일별 80% 커버리지 통과는 별도로 확인하며, 전체 평균만으로 기준 통과를 판단하지 않습니다. 정적 서빙·브라우저 테스트 전에 `bun run build:frontend`를 실행하세요. 브라우저 smoke는 합성 API 응답과 별도의 로컬 샘플 프로필을 사용하며 모델 요청은 보내지 않습니다. QA 하네스 manifest 케이스에는 저장소·branch·증거 상태 사전 조건도 있습니다.

Windows npm 명령 shim으로 Bun을 설치했다면 브라우저 smoke에 `--bun <bun.exe의 절대경로>`를 전달합니다. 여러 브라우저 검증이 같은 PC 자원을 놓고 경쟁하지 않도록 순차 실행하세요.

## 한계

- **임의 HTML 리서치 파싱은 없습니다.** 라이브 리서치 출처는 문서화된 claim 형태의 구조화 JSON이어야 합니다. 웹 페이지를 긁어서 디자인 규칙을 만들지 않습니다. HTML / CSS에서 디자인 시스템을 추출하는 건 별도 계약을 가진 다른 하위 시스템입니다.
- **리서치 UI가 없습니다.** run을 시작하거나 관찰하거나 탐색하는 화면이 없습니다. API나 QA CLI를 쓰세요.
- **run 결과는 아직 프롬프트로 들어가지 않습니다.** 턴마다 주입되는 리서치 블록은 저장소에 포함된 카탈로그에서 만들어집니다. 영속화된 run 결과를 purpose에 맞춰 선택하는 기능(`selectResearchPromptContext`)은 구현되고 테스트되어 있지만, 프롬프트 빌더가 아직 사용하지 않습니다.
- **카탈로그는 한정적입니다.** 출처 45개, 공통 규칙 15개, prompt purpose 10개, persisted-research purpose 6개이고 모두 한 날짜에 수집되었습니다. 규칙에 한계가 붙어 있는 데는 이유가 있습니다. 보편 법칙처럼 쓰기 전에 읽으세요.
- **표본 기반 지침은 법이 아닙니다.** 표본 시스템의 수치, 그리드, 벤더 토큰 이름은 그 시스템 고유로 남습니다.
- **PDF / PPTX export에는 Chromium이 필요합니다.** 렌더링은 `playwright-core`를 거치며 번들 Chromium을 실행하고, 안 되면 설치된 Chrome이나 Edge 채널로 폴백합니다. 셋 다 없으면 해당 export 작업은 Chromium 안내와 함께 실패합니다.
- **PDF / PPTX 인제스트에는 Python이 필요합니다.** 해당 형식의 디자인 시스템 업로드와 채팅 첨부는 `pypdf` 기반 Python 추출기를 거칩니다.
- **데이터 레코드가 결과물을 보증하지는 않습니다.** 적합성은 렌더링된 결과를 실제 표면에서 테스트해야 확인됩니다.

### 라이선스와 저작자 표시

BurnGuard는 Apache-2.0입니다([LICENSE](LICENSE)). 서드파티 표시는 [NOTICE](NOTICE)에 있습니다. daisyUI(MIT)에서 파생한 변환 테마 데이터와, 번들된 Lucide 아이콘 38개(ISC, 전문은 `packages/backend/src/harness/assets/lucide/LICENSE`)입니다. 리서치 출처는 각 원장 레코드의 `license_usage` 필드에 자기 조건을 갖고 있습니다. 재서술된 원칙을 넘어 무언가를 재사용하기 전에 그 메모를 확인하고, 경로별로 다른 조건을 가진 출처에 저장소 전체 라이선스를 가정하지 마세요.

## 로드맵

아직 출시되지 않은 항목입니다. 현재 동작으로 오해하지 않도록 따로 둡니다.

- 리눅스 패키징과 배포 경로
- Windows / macOS 설치 패키지, 서명과 공증
- 관리형 자동 업데이트 채널
- 완전한 브라우저 E2E 자동화
- 리서치 UI, 그리고 영속화된 run 결과의 프롬프트 반영

## 기여와 개발

먼저 [doc/CONTRIBUTING.md](doc/CONTRIBUTING.md)를 읽고, 문서 색인은 [doc/README.md](doc/README.md)를 보세요. 리서치 작성 규칙은 [doc/research.md](doc/research.md)에 있습니다.

이 저장소에서 실제로 지켜지는 약속들:

- 계약은 `packages/shared`에 두고 경계에서 파싱합니다. 호출부에서 `any`로 우회하지 말고 파서에 필드를 추가하세요.
- 카탈로그 JSON은 canonical 형식입니다. `JSON.stringify(value, null, 2)`에 마지막 개행 하나, 레코드는 안정 ID 기준 정렬, 인용 배열도 정렬, ID는 절대 재사용하지 않습니다. 검증기가 전부 강제합니다.
- 출처는 원본 페이지, 사용 조건, 반례 검색을 확인한 뒤에만 추가합니다. 근거는 재서술로 20단어 미만을 유지합니다.
- 테스트는 올바른 이유로 실패해야 합니다. 고정 sleep 금지, 타이밍 운 금지, 산문 고정 금지.
- PR을 열기 전에 `bun run lint`, `bun run typecheck`와 관련 `bun test` 대상을 실행하세요.
