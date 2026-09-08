# 2026-09-08 검토 수정·검증 기록

이 문서는 2026-09-08 전체 코드·UI·UX 검토의 R01–R37, 유지보수 제안, 사용자 여정 개선, 추가 검증 후보를 추적한다. 검토 기준은 `main`의 `a4ebac003ae7769da47678d6b6d74abf2d642cac`이며 수정 브랜치는 `codex/review-improvements-20260908`이다. Git 제외 폴더의 원본 리뷰·실행 로그를 변경하지 않고, 검토자가 저장소만으로 변경 목적과 검증 위치를 확인할 수 있도록 작성했다.

이 문서는 **최종 구현·검증 기록**이다. 선택 필터 없이 실행한 실제 브라우저 19개 시나리오, Windows compiled portable smoke, frozen-lock 설치의 통과 결과를 반영했다. 전체 테스트는 1,034개 통과·20개 건너뜀·실패 0개이며, 파일별 80% 커버리지 기준은 미통과다. 아래 표에 통과한 실행과 남은 기준을 구분했다. 절대경로, 사용자 데이터 위치, 비공개 로그 원문은 포함하지 않는다.

## 읽는 방법

- `B/`는 `packages/backend/`, `F/`는 `packages/frontend/`, `S/`는 `packages/shared/`를 뜻한다. 나머지는 저장소 루트 기준 상대경로다.
- 표의 테스트 파일은 해당 수정의 회귀 조건을 찾는 위치다. 파일명이 기재됐다는 이유만으로 모든 환경의 완료 기준이 충족된 것은 아니다.
- **구현 반영**은 해당 동작의 코드와 회귀 검증 경로를 추가했다는 뜻이다. 전체 테스트·커버리지와 검증하지 않은 외부 환경의 성공까지 뜻하지 않는다.
- 브라우저 합성 fixture는 실제 DOM, IndexedDB, File, EventSource, 미디어 변경을 사용하지만 HTTP 응답·작업 결과는 검증용 데이터다. 실제 공급자·Figma 서비스의 성공과 구분한다.

## R01–R37 수정 대응

| ID | 문제와 변경된 동작 | 주요 구현 파일 | 회귀 증거와 남은 확인 |
|---|---|---|---|
| R01 | 삭제 전에 활성 작업·보존 참조를 검사한다. 삭제 불가 시 409와 함께 파일을 보존하고, rename·삭제 receipt로 DB 실패와 재시작을 복구한다. | `B/src/services/project-deletion.ts`, `B/src/routes/project.ts`, `B/src/bootstrap.ts` | `B/tests/review-artifact-safety.test.ts`: learning 참조, 활성 turn, DB 실패, 일반 삭제, rename 후 재시작, 외부 경로 보존. 구현 반영. |
| R02 | mapped/확장 IPv6를 같은 사설 주소 정책으로 검사한다. DNS 실패를 거부하고 redirect마다 HTTPS·주소를 검증하며 논리 TLS 호스트와 검증한 연결 IP를 묶는다. | `B/src/services/extraction-path.ts`, `B/src/services/extraction-website.ts` | `B/tests/extraction-website-boundaries.test.ts`: 14개 회귀 통과. 실제 로컬 전송의 IP/Host, TLS 이름 확인, 환경 프록시의 CONNECT 대상 IP를 검사했다. 프록시 테스트는 별도 프로세스로 격리한다. |
| R03 | 생성 prompt의 쓰기 경로와 adapter 실행 디렉터리를 같은 stage로 맞춘다. 성공 게시 전 live bytes를 변경하지 않는다. | `B/src/services/turns.ts`, `B/src/harness/prompt-builder.ts` | `B/tests/review-turn-execution.test.ts`: prompt가 가리킨 경로에 쓰는 adapter와 성공·실패·중단 전후 identity. 실제 공급자 실행은 별도 확인. |
| R04 | exit code 실패와 terminal 오류를 publication 전에 실패로 확정한다. 부분 stage를 성공 결과나 checkpoint로 게시하지 않는다. | `B/src/services/turns.ts` | `B/tests/review-turn-execution.test.ts`: 쓰기 후 exit/event 실패 시 live bytes·revision 유지와 성공 checkpoint 부재. 구현 반영. |
| R05 | 같은 capture의 manifest·bytes를 DB와 baseline에 반영한다. 관찰·초기화·publication을 프로젝트별로 직렬화하고 INSERT 직전 CAS를 확인한다. 외부 저장 도중 재변경과 watcher의 후속 신호를 다시 검사한다. | `B/src/services/artifact-coordinator.ts`, `B/src/services/artifact-project-lock.ts`, `B/src/services/artifact-initialization.ts`, `B/src/services/watchers.ts` | `B/tests/review-artifact-safety.test.ts`와 실제 route 회귀: 최초 병렬 GET→텍스트·스타일 PATCH→DELETE, 외부 저장+동시 조회, publication 중 GET, 구버전 stale working row 복구 통과. |
| R06 | replay queue가 빌 때까지 순서대로 전달한 뒤 live로 전환하며 live emit도 직렬화한다. | `B/src/services/sequenced-event-replay.ts`, `B/src/routes/session.ts` | `B/tests/review-session-consistency.test.ts`: 느린 replay emit 중 publish, 중첩 live emit에서 sequence 누락·중복 없음. 구현 반영. |
| R07 | 실제 덱이 참조하는 `/runtime/deck-stage.js`를 production server에 연결한다. | `B/src/server.ts`, `B/src/routes/runtime.ts` | `B/tests/review-session-consistency.test.ts`: 정확한 JavaScript 응답. `scripts/qa/package-smoke.mjs`: 최종 compiled 배포물 runtime 응답 통과. R26의 실제 iframe 이동 검증은 합성 덱을 사용하므로 production runtime 전체 동작 검증과 구분한다. |
| R08 | 도구 허용·거절 요청에 프로젝트 ID가 아닌 현재 `session.id`를 전달한다. backend는 현재 대기 중인 요청만 원자적으로 결정한다. | `F/src/views/ProjectView.tsx`, `F/src/api/session.ts`, `B/src/routes/session.ts` | `F/tests/session-review.test.ts`, `B/tests/review-turn-execution.test.ts`: ID·중복 결정 회귀. `scripts/qa/review-ui-fixtures.mjs`: 합성 API와 실제 DOM에서 다른 프로젝트/세션 ID의 허용·거절·reload 통과. |
| R09 | 현재 세션의 최근 user/assistant 대화를 prompt에 전달한다. 20개 메시지·200개 조회 이벤트·16,000자 상한을 두고 다른 세션과 첨부 비공개 경로를 제외한다. | `B/src/db/conversation-history.ts`, `B/src/services/context.ts`, `B/src/harness/prompt-builder.ts` | `B/tests/review-session-consistency.test.ts`: 이전 답변의 선택지·역할, 길이 상한, 세션 분리. 모델의 실제 다중턴 응답 품질은 별도 확인. |
| R10 | stdout/stderr reader 실패를 즉시 관찰하고 소유 프로세스 트리를 중단한 뒤 reader와 프로세스를 함께 정리한다. | `B/src/adapters/process-streams.ts`, `B/src/adapters/claude-code/runner.ts`, `B/src/adapters/codex/index.ts` | `B/tests/review-turn-execution.test.ts`: 실제 Windows 자식 트리의 연속 출력 중 callback 실패와 종료. 기존 skip만을 완료 근거로 사용하지 않는다. |
| R11 | 렌더 이후 validate/receipt/publish 단계에도 취소를 확인하고 완료 SQL이 durable 취소 조건을 검사한다. 복구도 cancelled를 유지한다. | `B/src/services/exports.ts`, `B/src/db/export-lifecycle-repository.ts`, `B/src/services/export-recovery.ts` | `B/tests/design-audit-export.test.ts`: 늦은 3단계 취소. `B/tests/export-recovery.test.ts`: 재시작 복구. 해당 회귀와 최종 전체 테스트의 관련 사례가 통과했다. |
| R12 | 보존기간을 두 번 더하지 않고 절대 만료시각 `retained_until <= now`에서 정리한다. | `B/src/services/export-gc.ts`, `B/src/services/export-gc-storage.ts` | `B/tests/export-gc.test.ts`: 실제 SQLite 만료 전·정확한 경계·재실행과 파일 삭제를 포함한 7개 회귀 통과. |
| R13 | 성공 결과가 없거나 손상되면 DB 상태·이벤트·가용성을 corrupt/unavailable로 맞추고 재시도를 허용한다. | `B/src/services/export-recovery.ts`, `B/src/db/export-lifecycle-repository.ts` | `B/tests/export-recovery.test.ts`: INSERT ABORT 때 검증된 결과를 보존하는 경계까지 15개 복구 회귀 통과. `F/tests/export-review.test.ts`: 손상 결과 다운로드 차단·재시도. |
| R14 | 디렉터리를 같은 이름의 파일로 바꾸는 publication과 undo에서 충돌 경로를 올바른 순서로 교체한다. 실패 시 원래 트리를 복원한다. | `B/src/services/artifact-tree-storage.ts`, `B/src/services/artifact-recovery.ts` | `B/tests/review-artifact-safety.test.ts`: directory→file, undo, 실패 rollback, 재시작 receipt 복구. 구현 반영. |
| R15 | file URL의 cwd를 올바르게 해석한다. Windows Chromium은 번들 Node의 launch server와 실제 WebSocket 연결을 사용하며 설치도 같은 Node/CLI를 사용한다. | `B/src/services/chromium-capability.ts`, `B/src/services/chromium-node-bridge.mjs`, `B/src/services/chromium-node-launch.ts`, `B/src/services/playwright-install.ts` | `B/tests/chromium-capability.test.ts` 9개, `B/tests/chromium-node-launch.test.ts` 3개 실제 Node/브라우저 회귀 통과. `B/tests/chromium-process-tree.test.ts`: 제한시간 후 실제 부모·자식 종료. 최종 이동 배포물의 번들 Node probe도 통과. |
| R16 | 디자인 방향 초기 상태 기록도 작업 정리 범위에 넣어 실패 시 예약·잠금을 해제한다. | `B/src/services/design-direction-workflow.ts` | `B/tests/design-direction-workflow.test.ts`: 초기 상태 실패 후 다시 실행 가능. 해당 파일의 12개 회귀 통과. |
| R17 | 생성 중 선택을 거부하고 SQLite CAS로 상태 전이를 확정해 늦은 렌더가 사용자 선택을 덮어쓰지 못하게 한다. | `B/src/services/design-direction-workflow.ts`, `B/src/services/design-direction-state.ts` | `B/tests/design-direction-workflow.test.ts`: 실행 중 선택·동시 상태 전이 경계. 구현 반영. |
| R18 | renderer 내부 예외를 안정적인 공개 오류 코드·안내로 바꾸고 private marker를 응답에 넣지 않는다. | `B/src/services/design-direction-workflow.ts` | `B/tests/design-direction-workflow.test.ts`: 내부 경로 marker 배제와 공개 실패 상태. 구현 반영. |
| R19 | ASCII 정규화 결과가 같은 Figma 색상 이름에 안정적인 hash 식별자를 붙여 서로 다른 원본을 보존한다. | `B/src/services/figma.ts` | `B/tests/figma-client.test.ts`: 한글 이름·충돌·안정성 등 19개 회귀 통과. 실제 Figma 계정 호출은 별도 확인. |
| R20 | PPTX theme의 자식 `srgbClr@val`과 `sysClr@lastClr`를 읽어 팔레트를 추출한다. | `B/src/services/upload-extractor-py.ts` | `BG_UPLOAD_SMOKE=1 bun test packages/backend/tests/upload-extract-smoke.test.ts`: 실제 Python의 최소 PPTX 등 4개 smoke 통과. |
| R21 | DB 상태·usage와 event sequence를 같은 transaction으로 확정한다. frontend는 snapshot 지점 이후 이벤트만 누적하고 replay 이력은 보존한다. | `B/src/db/events.ts`, `B/src/db/session-snapshot.ts`, `S/src/project.ts`, `F/src/hooks/useSessionEvents.ts`, `F/src/lib/session-event-state.ts` | `B/tests/review-session-consistency.test.ts`, `F/tests/session-review.test.ts`: 누적·응답 역전·같은 시각 순서. `scripts/qa/review-ui-fixtures.mjs`: 합성 snapshot/SSE와 실제 EventSource·DOM에서 중복 delta·reload 후 사용량 유지 통과. |
| R22 | 현재 pending을 durable snapshot에서 읽는다. 결정 이벤트·tool 완료·terminal·새 실행 경계를 반영해 과거 권한 요청을 다시 열지 않는다. | `B/src/db/session-snapshot.ts`, `B/src/routes/session.ts`, `S/src/events.ts`, `F/src/lib/session-event-state.ts` | `B/tests/review-session-consistency.test.ts`, `B/tests/review-turn-execution.test.ts`, `F/tests/session-review.test.ts`. `scripts/qa/review-ui-fixtures.mjs`: 합성 API와 실제 allow/deny·reload DOM에서 과거 요청 미노출 통과. |
| R23 | 채팅 탭의 mount를 유지하고 세션별 IndexedDB 초안에 텍스트·File·역할을 저장한다. 복원 완료 전 입력을 잠그고 성공 전송 후에만 지운다. | `F/src/components/chat/ChatPane.tsx`, `F/src/components/chat/Composer.tsx`, `F/src/components/chat/useComposerDraft.ts` | `F/tests/session-review.test.ts`: draft 검증. `scripts/qa/review-ui-fixtures.mjs`: 실제 IndexedDB/File의 탭 왕복·reload·세션 분리·역할 유지와 합성 API에 보낸 multipart bytes·성공 후 삭제 통과. |
| R24 | 자신의 drawing commit 반영으로 history를 초기화하지 않는다. 외부 파일 reset만 구분하고 저장 요청을 직렬화한다. 읽기·저장 오류 중 다른 파일에 잘못 쓰지 못하게 한다. | `F/src/components/canvas/DrawLayer.tsx`, `F/src/components/canvas/Canvas.tsx`, `F/src/views/ProjectView.tsx` | `scripts/qa/e2e-smoke.mjs`: 실제 그리기→Undo→Redo 및 저장 SVG의 정확한 복원 확인. |
| R25 | Escape가 유발한 blur 저장을 억제하고 Enter와 blur의 중복 commit을 없앤다. | `F/src/components/modes/TweaksPanel.tsx` | `F/tests/canvas-edit-review.test.ts`: Escape 0회·Enter 1회. `scripts/qa/e2e-smoke.mjs`: 실제 style edit와 요청·revision 확인. |
| R26 | 파일별 슬라이드 위치를 기억하고 iframe이 실제 적용한 clamp index를 받는다. opaque sandbox의 srcdoc에서 상대 fragment가 HTTP `<base>`로 해석되던 `SecurityError`를 현재 iframe URL 기반 hash 갱신으로 수정했다. 0장/비슬라이드에서도 복원 상태를 해제한다. | `F/src/components/canvas/Canvas.tsx`, `F/src/components/canvas/frame-bridge.ts` | `F/tests/canvas-edit-review.test.ts`, `scripts/qa/review-canvas-fixtures.mjs`: 수정 후 실제 Chrome의 합성 덱에서 10장 index 9→3장 clamp 2→댓글 일치→이전 장→파일별 위치 복원 통과. 단독 회귀와 최종 19개 전체 DOM 실행 모두 통과. |
| R27 | 색상 editor의 열림 상태와 이름 값을 분리한다. 이름을 모두 지워도 폼을 유지하며 오류와 저장 비활성화를 표시한다. | `F/src/views/DesignSystemView.tsx` | `F/tests/settings-system-review.test.ts`: 빈 이름에서도 editor·접근 가능한 오류·저장 비활성화. |
| R28 | Figma token PATCH 응답의 token 설정 여부만 일반 설정 초안에 병합한다. | `F/src/components/settings/SettingsModal.tsx` | `scripts/qa/review-ui-fixtures.mjs`: 합성 설정 API와 실제 DOM에서 일반 값 편집→token 저장/해제→일반 저장 보존 통과. 실제 Figma 연결 검증은 아니다. |
| R29 | 필수 설정·backend 감지·Chromium·Python 상태를 독립 query로 읽고 각 실패에 재시도를 제공한다. | `F/src/components/settings/SettingsModal.tsx` | `scripts/qa/review-ui-fixtures.mjs`: 합성 API 실패 주입과 실제 DOM에서 설정 자체 실패 복구·Chromium 실패 중 일반 설정 편집 통과. |
| R30 | 디자인 시스템을 ID별 React Query 상태로 관리하고 실패·404·재시도·홈 이동을 제공한다. 새 ID 아래 이전 데이터를 표시하지 않는다. | `F/src/views/DesignSystemView.tsx` | `scripts/qa/review-ui-fixtures.mjs`: 합성 API와 실제 DOM에서 A→없는 B 전환·이전 데이터 제거·B 재시도 복구 통과. |
| R31 | 현재 프로젝트 파일의 실제 text/image를 읽고 loading/error/삭제 상태를 표시한다. 취소, 텍스트 1MB·이미지 20MB 상한과 원본 다운로드를 제공한다. | `F/src/views/DesignFilesView.tsx`, `F/src/components/files/FilePreview.tsx` | `F/tests/canvas-edit-review.test.ts`: bytes·MIME·404·취소·큰 image stream 중단. `scripts/qa/review-canvas-fixtures.mjs`: 합성 파일 응답을 실제 DOM에서 읽어 CSS 원문·PNG 디코딩·native 요청 취소·늦은 응답 무시 통과. |
| R32 | API 권한을 확보하기 전에도 준비·오류·재시도 화면을 렌더한다. 초기화에 timeout·AbortController를 적용한다. | `F/src/main.tsx`, `F/src/components/Bootstrap.tsx`, `F/src/api/client.ts` | `F/tests/client.test.ts`: malformed bootstrap·과거 capability 재사용 금지. `scripts/qa/review-ui-fixtures.mjs`: 합성 bootstrap 실패 후 실제 DOM의 안내·재시도로 홈 복구 통과. |
| R33 | 저장된 light/dark/auto를 루트 semantic 색상과 연결하고 시스템 설정 변경을 구독한다. | `F/src/App.tsx`, `F/src/hooks/useTheme.ts`, `F/src/index.css` | `F/tests/session-review.test.ts`: explicit/auto 분기. `scripts/qa/review-ui-fixtures.mjs`: 합성 설정 API와 실제 DOM/media에서 저장·reload·시스템 설정 변경 통과. 실제 시각 대비 전체 평가는 별도 확인. |
| R34 | input label/id, backend·context·theme의 선택 상태, dialog 종료 후 포커스를 명시한다. | `F/src/views/DesignSystemView.tsx`, `F/src/components/settings/BackendSelector.tsx`, `F/src/components/settings/SettingsModal.tsx` | `F/tests/settings-system-review.test.ts`: 이름·invalid·aria-pressed. 실제 DOM에서 1024/390px 생성 버튼의 키보드 진입과 Escape/Enter 편집 통과. 전체 포커스 순서·Windows Narrator 실측은 미검증. |
| R35 | 보호된 프로젝트 목록 대신 공개 health의 서비스 identity로 기존 BurnGuard를 식별한다. | `scripts/dev-launcher.ts` | `B/tests/launcher-readiness.test.ts`: capability 없는 정상 앱·다른 HTTP 서비스. `scripts/qa/package-smoke.mjs`: 실제 배포물 health. |
| R36 | Windows 배포 단위를 exe와 resource 폴더로 구성하고 frontend·runtime·migration·seed·Playwright·Node 자산을 함께 준비한다. 소스 checkout/cwd에 의존하지 않게 경로를 결정한다. | `scripts/build-binary.ts`, `scripts/build-mac.ts`, `scripts/package-runtime.ts`, `B/src/lib/paths.ts`, `B/src/db/migrate-local.ts` | `B/tests/package-resources.test.ts`, `scripts/qa/package-smoke.mjs`: 한글·공백 경로로 이동한 배포물, PATH의 Node/Bun 없이 health·migration·seed·UI·runtime·번들 Node probe 통과. macOS 실제 배포 실행은 미검증. |
| R37 | 테스트 preload가 프로세스마다 전용 `BG_APP_ROOT`를 만들고 기본 사용자 DB 사용을 차단한다. | `scripts/test-preload.ts`, `bunfig.toml`, `B/src/lib/app-paths.ts`, `B/src/db/sqlite-client.ts` | `B/tests/test-isolation.test.ts`: 상속된 앱 경로를 별도 root로 교체, 자식 테스트 전후 기존 profile 파일 유지. root에서 실행하는 전체 테스트에도 같은 격리 적용. |

## 원본 6절: 유지보수 개선

| 개선 | 반영 내용 | 구현·검증 위치 | 현재 경계 |
|---|---|---|---|
| 설정 읽기/쓰기 분리·원자적 저장 | GET/기존 설정 로드는 파일을 다시 쓰지 않는다. PATCH를 직렬화하고 원자적으로 저장하며 손상된 원본은 보존한다. | `B/src/config.ts`, `B/src/routes/home.ts`, `B/tests/config-storage.test.ts` | 동시 독립 PATCH, 파일 identity 유지, 손상 JSON 보존, 잘못된 필드 검증. 최종 전체 회귀에 포함. |
| 독립 설치 재현성 | `bun.lock`을 추적 대상으로 바꾸고 재현 가능한 설치 명령과 runtime 의존성을 문서화한다. | `.gitignore`, `bun.lock`, `package.json`, `B/package.json`, `README.md`, `README.ko.md` | 현재 lockfile 기준 frozen-lock 설치 통과. |
| 테스트와 coverage 범위 분리 | 일반/focused 테스트와 `bun run test:coverage`를 분리하고 기존 80% coverage 기준을 유지한다. 기본 timeout은 30초다. | `bunfig.toml`, `package.json`, `README.md`, `README.ko.md` | frontend 단위 테스트 통과와 전체 coverage 통과를 혼동하지 않는다. 전체 측정은 완료했으며 파일별 80% 기준은 미통과다. 아래 최종 수치를 참조한다. |
| 빌드 실패 근거 | build가 compile/resources 등 실패 단계를 오류와 함께 남기고 package smoke가 실제 배포물 검사를 기록한다. | `scripts/build-binary.ts`, `scripts/build-mac.ts`, `scripts/qa/package-smoke.mjs` | Windows compiled portable smoke의 최종 재검증 통과. `remediation-package-final.log`에 health·migration/seed·UI/runtime·번들 Node probe 결과 기록. |
| Windows 실제 프로세스 종료 | 공유 stream 정리에서 reader 실패를 즉시 관찰하고 실제 자식 트리를 종료한다. | `B/src/adapters/process-streams.ts`, `B/tests/review-turn-execution.test.ts` | 실제 Windows callback 실패 경로 통과. abort/timeout/부모 종료의 모든 외부 CLI 조합을 검증했다고 주장하지 않는다. |
| 큰 UI의 상태 경계 | 이벤트 병합·구독, theme, composer draft를 해당 책임의 hook/순수 함수로 이동했다. | `F/src/hooks/useSessionEvents.ts`, `F/src/lib/session-event-state.ts`, `F/src/hooks/useTheme.ts`, `F/src/components/chat/useComposerDraft.ts` | 새로운 상태 라이브러리 없이 기존 React·React Query·브라우저 저장소 사용. |
| 내부 구현 문구 제거 | Phase/Sprint/API placeholder를 실제 결과·다음 행동 안내로 바꿨다. 편집 대상의 기술 ID는 고급 상세로 이동했다. | `F/src/components/files/FilePreview.tsx`, `F/src/components/systems/SystemPreviewGrid.tsx`, `F/src/views/HomeView.tsx`, `F/src/components/modes/EditPanel.tsx` | 사용자 오류에는 안정된 한국어 code mapping 사용. 진단 원문을 성공/실패 안내와 섞지 않는다. |

## 원본 7절: 사용자 여정 개선

| 사용자 여정 | 적용한 동작 | 구현·회귀 위치 | 최종 확인 |
|---|---|---|---|
| 최초 실행 | 초기화와 설정 각각 loading/error/retry를 제공한다. | R29/R32, `scripts/qa/review-ui-fixtures.mjs` | 합성 API 실패 주입과 실제 DOM의 bootstrap·설정 복구 통과. |
| 홈→새 프로젝트 | 좁은 화면에서도 상단 생성 링크로 폼에 바로 이동할 수 있다. | `F/src/views/HomeView.tsx`, `F/src/components/layout/Sidebar.tsx`, `scripts/qa/e2e-smoke.mjs` | 실제 backend와 DOM에서 1024/390px 생성 버튼 focus·Enter 진입과 가로 넘침 없음 통과. |
| 홈 탐색 | 디자인 시스템 이름·상태 필터와 결과 없음 상태를 제공한다. | `F/src/views/HomeView.tsx`, `F/tests/home-search.test.ts` | 검색 함수 회귀와 실제 홈·탭 렌더 통과. 최종 19개 DOM 시나리오에는 한글 검색 입력을 통한 별도 단언이 포함되지 않는다. |
| 프로젝트 카드 | hover 없이 메뉴를 찾을 수 있고 조작 영역은 44px다. | `F/src/components/home/ProjectCard.tsx`, `scripts/qa/e2e-smoke.mjs` | 실제 backend와 DOM에서 카드 옵션→삭제 확인→삭제 성공·카드 제거 통과. touch와 메뉴 전체 키보드 순서는 별도 실측하지 않았다. |
| 채팅/코멘트 | 현재 permission과 세션별 초안을 복구한다. | R08/R21/R22/R23, `scripts/qa/review-ui-fixtures.mjs` | 합성 API와 실제 DOM/EventSource/IndexedDB/File에서 사용량·allow/deny·reload·초안·역할·전송 bytes 통과. 실제 backend의 댓글 작성·저장도 별도 시나리오로 통과. |
| 캔버스 편집 | Undo/Redo·취소·파일 전환·저장 실패 상태를 맞추고 실패 중 다른 파일 쓰기를 차단한다. | R24–R26, `scripts/qa/e2e-smoke.mjs`, `scripts/qa/review-canvas-fixtures.mjs` | 실제 backend에서 텍스트·drawing 저장, Undo/Redo SVG 복원, Escape 0회/Enter 1회 요청 통과. 합성 덱의 실제 iframe clamp·댓글·위치 복원도 통과. |
| 편집 패널 | 사람이 읽는 텍스트·링크·이미지 설명을 먼저 보여주고 기술 속성은 상세 영역에 둔다. | `F/src/components/modes/EditPanel.tsx` | 실제 DOM의 요소 선택→텍스트 편집→저장 통과. 기술 상세 영역의 전체 키보드 순서·주관적 설명 품질은 별도 평가하지 않았다. |
| 디자인 시스템 preview | 실제 존재하는 HTML 목록을 API로 조회한다. 없는 섹션을 만들지 않고 빈 상태와 실패를 구분하며 상대 CSS 자원을 보존한다. | `B/src/routes/catalog.ts`, `S/src/design-system.ts`, `F/src/components/systems/SystemPreviewGrid.tsx`, `F/src/components/systems/PreviewIframe.tsx`; `B/tests/catalog-preview-review.test.ts`, `F/tests/settings-system-review.test.ts` | 목록·HEAD·상대 CSS·404·빈 상태 API 회귀 3개 통과. 시스템 route 오류 복구는 실제 DOM에서 확인했으나 최종 19개 시나리오가 모든 preview iframe의 시각 렌더를 검사한 것은 아니다. |
| 내보내기 | 취소·손상·만료 상태를 항상 표시하고 실제 가용한 결과만 다운로드한다. 재시도는 기존 job 옵션과 최신 artifact identity를 사용한다. | R11–R13, `F/src/api/export.ts`, `F/src/components/export/ExportMenu.tsx`, `F/src/components/export/ExportStatusList.tsx`, `F/src/components/export/export-job-state.ts`; `F/tests/export-review.test.ts` | frontend 3개 회귀 통과. HTTP 오류를 파일로 내려받거나 JSON 페이지로 이동하지 않는다. |
| 오류 처리 | private marker를 사용자 안내에 넣지 않고 기존 한국어 code mapping을 확장했다. 작동하지 않던 오류 버튼은 실제 메시지 입력 포커스 복구로 바꿨다. | `F/src/lib/error-copy.ts`, `F/src/components/chat/blocks/ErrorCard.tsx`, `F/tests/error-card.test.ts`, `F/tests/export-review.test.ts` | raw 오류 배제 회귀 통과. 추가 실제 서비스 오류 종류는 별도 환경 검증 대상. |

## 원본 9절: 추가 검증 후보

후보는 확정 결함 수에 추가하지 않는다. 아래는 이번 수정으로 얻은 근거와 여전히 필요한 확인을 구분한 기록이다.

| 후보 | 조사·반영 결과 | 근거 | 남은 검증 |
|---|---|---|---|
| 같은 millisecond 이벤트 순서 | timestamp/ID 정렬을 없애고 durable sequence로 merge·정렬한다. | `F/src/lib/session-event-state.ts`, `F/tests/session-review.test.ts`: 같은 시각·역순 ID와 중복 chunk | 단위 회귀 통과. 합성 SSE와 실제 EventSource·DOM에서 중복 delta·reload 상태 일치도 통과. |
| 압축 업로드 해제 크기 | ZIP entry 개수·XML 크기·총 해제량에 상한을 두고 PPTX 파싱 전에 검사한다. | `B/src/services/upload-extractor-py.ts`, `B/tests/upload-extract-smoke.test.ts` | 안전한 작은 fixture를 사용했다. 실제 압축 폭탄을 만들거나 실행하지 않았다. |
| 설정 동시 저장·손상 | 동시 PATCH를 직렬화하고 GET 무쓰기·원자적 저장·손상 원본 보존을 반영했다. | `B/src/config.ts`, `B/tests/config-storage.test.ts` | 해당 회귀를 포함한 최종 전체 테스트에서 실패 0개를 확인했다. |
| export handoff 토큰 전달 | 현재 renderer handoff 구조를 대조했고 별도 launch token이 필요하다는 결함은 확인하지 않았다. 공통 renderer의 파일 경계는 실제 브라우저로 보강했다. | `B/src/services/export-render-session.ts`, `B/src/services/chromium-node-launch.ts`, `B/tests/chromium-node-launch.test.ts` | 이 확인을 모든 인증·외부 자원 로드 성공으로 확대하지 않는다. 필요한 공급자/인증 조합은 별도 확인. |
| artifact 보존·정리 | 30일 만료된 terminal operation 자료를 회당 최대 100건 정리하고 현재 복구 stage·canonical managed root·turn 전 자료를 보존한다. | `B/src/services/artifact-retention.ts`, `B/src/bootstrap.ts`, `B/tests/review-artifact-safety.test.ts` | 이전 undo의 가용성 안내와 복구 보존 회귀 포함. 총 저장용량 상한을 보장하는 정책은 아니며 장기 대용량 운영 측정은 별도 확인. |
| 실제 SSRF 접속 경계 | R02의 입력 검사뿐 아니라 연결 IP·TLS logical host·redirect·proxy 경계를 검증한다. | `B/src/services/extraction-website.ts`, `B/tests/extraction-website-boundaries.test.ts` | 소유한 로컬 fixture의 직접 연결·환경 proxy CONNECT IP·stream abort를 포함한 14개 회귀 통과. 외부 내부망을 대상으로 접속하지 않았다. |
| 외부 서비스 품질 | Python PPTX 추출, 로컬 Chromium/Node, audit/export의 일부 실제 실행 근거를 확보했다. | `B/tests/upload-extract-smoke.test.ts`, `B/tests/chromium-node-launch.test.ts`, `B/tests/design-audit-export.test.ts` | 실제 Figma/외부 웹·로그인된 모델 다중턴 품질, 모든 PDF/PPTX/PNG 사용자 여정은 완료로 표시하지 않는다. |
| 접근성·반응형·디자인 품질 | label·선택 상태·포커스·touch 영역·dark/auto 경로를 구현하고 DOM fixture를 보강했다. | `F/tests/settings-system-review.test.ts`, `scripts/qa/e2e-smoke.mjs`, `scripts/qa/review-ui-fixtures.mjs` | 실제 1024/390px 홈의 생성 버튼 키보드 진입·가로 넘침 검사, 편집 Escape/Enter, theme 저장·reload·media 변경 통과. Windows Narrator, 확대, 전체 포커스 순서·색상 대비 실측은 미검증. |

## 통합 실행에서 추가로 확인한 결함

- 최초 파일 GET과 watcher의 동시 관찰이 stale working row를 남기는 경합을 R05에 포함했다. `B/tests/review-artifact-concurrency.test.ts`가 실제 GET·PATCH·DELETE 및 재시작 경로를 검증한다.
- Windows 기본 그래픽 제목의 line-height를 1.4로 조정해 Segoe UI의 실제 글자 높이가 잘리는 문제를 수정했다. `B/tests/graphic-export.test.ts`의 긴 한글·최소 크기·세로 크기 및 PNG 결과 검증이 통과했다.
- Chromium의 graceful 종료와 probe 제한시간이 만료되면 기존 소유 프로세스 트리 정리기를 사용한다. `B/tests/chromium-process-tree.test.ts`에서 종료를 무시하는 실제 Node 부모·자식의 소멸을 확인했다.
- export 성공 상태와 validated event INSERT를 한 SQLite transaction으로 확정한다. event 저장 실패 시 recovery는 검증된 bytes·receipt를 보존하고 재시도한다. `B/tests/export-recovery.test.ts`의 실제 INSERT ABORT 주입 회귀가 통과했다.
- 테스트 fixture의 타이머·proxy·subprocess 환경 누출을 보강했다. 테스트 프로세스가 PATH의 명령 shim에 의존하지 않게 하고 stdout/stderr를 동시에 읽으며 제한시간을 둔다. Windows에서 사용할 수 없는 symlink는 명시적으로 건너뛰고 가능한 junction·hardlink 경계는 실제로 검증한다.

## 루트 최종 검증 기록

아래는 PR 제출 상태의 실행 결과다. 앞선 실패 실행은 수정 근거로 보존하며 통과 실행에 합산하지 않는다. coverage 명령의 테스트 결과와 기준 판정은 별도로 기록한다.

브라우저 최종 근거는 `.omo/evidence/review-2026-09-08/remediation-browser-verified.log`와 같은 폴더의 `browser-verified/`다. 로그의 `selection: null`, `passed: 19`, `failed: 0`, `ok: true`를 확인했다. 이 경로는 로컬에서 보존한 기록 위치이며, 저장소 검토에 필요한 검증 범위는 아래에 함께 적었다.

| 실제 브라우저 검증 구분 | 통과 수 | 검증한 범위 |
|---|---|---|
| 실제 격리 backend·DB·프로젝트 파일 | 9 | 홈·예제 열기, 텍스트 저장, 댓글 pin 저장, drawing 저장, Undo/Redo 후 SVG 복원, Escape/Enter 요청, 1024/390px 생성 버튼 키보드 진입, 프로젝트 삭제 |
| 합성 API/SSE와 실제 DOM·브라우저 저장소 | 7 | bootstrap 재시도, 설정 초안·부분 실패, 시스템 404 복구, snapshot/replay 사용량, 현재 permission의 allow/deny, IndexedDB/File 초안·역할·전송, theme 저장·reload·media 변경 |
| 합성 덱·파일 응답과 실제 iframe/요청 취소 | 3 | opaque srcdoc hash/base 수정 후 slide clamp·댓글·파일별 위치 복원, CSS 원문·PNG 디코딩, 지연 요청의 native abort와 오래된 응답 무시 |

Windows 최종 배포물 근거는 `.omo/evidence/review-2026-09-08/remediation-package-final.log`다. 컴파일된 실행 파일을 한글·공백 디렉터리로 옮기고 PATH의 Node/Bun 없이 health, 새 migration/seed, UI/JavaScript runtime, 번들 Node browser probe를 확인해 `ok: true`를 얻었다.

| 검증 | 현재 확인한 결과 | 최종 상태 |
|---|---|---|
| 전체 테스트 | `bun run test:coverage`에서 **1,034 pass / 20 skip / 0 fail / 6,665 assertions / 131 files**, 235.70초. `remediation-coverage-verified.log` | 테스트 실패 0개. 20개 platform/권한/opt-in skip은 통과에 합산하지 않는다. 명령 자체는 아래 coverage 기준으로 exit 1이다. |
| 전체 coverage | 함수 **82.89%**, 줄 **83.45%**. 측정 대상 291개 중 74개 파일이 함수 또는 줄 80%에 미달한다. | **파일별 80% 기준 미통과, exit 1**. 기존 기준·측정 대상을 낮추지 않았다. |
| 타입 검사 | 최종 `bun run typecheck` 통과, exit 0 | `remediation-typecheck-verified.log`. |
| lint/diff 검사 | `bun run lint` 및 전체 staged `git diff --check` 통과 | lint는 공백 오류 검사이며 별도 정적 분석 도구의 통과로 표현하지 않는다. |
| frontend 회귀 | 앞선 frontend 전체 155 pass / 0 fail / 375 assertions / 24 files. 이후 R26 회귀를 포함한 최종 전체 실행도 실패 0개 | 겹치는 실행을 합산하지 않는다. |
| backend 회귀 | R02 실제 IP/TLS/proxy 14 pass, 최종 export recovery·artifact concurrency·safety 묶음 34 pass / 0 fail / 105 assertions. 전체 실행에도 포함 | 실제 외부 서비스의 성공까지 뜻하지 않는다. |
| Windows 빌드 | frontend 및 Windows binary/resources build 통과. 최종 production 변경 후 backend 재빌드 통과 | Vite의 500KB 초과 chunk 경고는 남는다. macOS 실행은 미검증. |
| 이동한 Windows 배포물 | `scripts/qa/package-smoke.mjs`의 compiled portable 실행 통과. `remediation-package-final.log`의 4개 check와 `ok: true` | 한글·공백 경로, Node/Bun 없는 PATH에서 health·migration·seed·UI·runtime·번들 Node browser probe 확인. |
| 실제 브라우저 | **19 pass / 0 fail**, `selection: null`, exit 0. `remediation-browser-verified.log` 및 `browser-verified/` | 위 구분표의 실제 backend 9개·합성 API/파일 기반 10개 모두 실제 브라우저에서 통과. |
| 실제 export·upload | `BG_EXPORT_SMOKE=1` export smoke **7 pass**로 PDF/PNG/PPTX 결과 확인. `BG_UPLOAD_SMOKE=1` Python smoke **4 pass** | opt-in 실행이며 기본 실행의 skip과 구분한다. 모든 사용자 자료·외부 서비스 품질 검증은 아니다. |
| CLI·런처 회귀 | qa harness·research routes·launcher **13 pass / 6 Windows platform skip / 0 fail** | skip을 통과에 합산하지 않는다. |
| frozen-lock 설치 | `bun install --frozen-lockfile` 통과. `playwright-core` 1.59.1과 `bun.lock` 고정 | dependency 변경 후 현재 lock 기준으로 확인했다. |
| 제출 범위 | R01–R37 구현·회귀·이 대응표를 같은 브랜치로 제출 | 원본 ignored review/evidence와 기존 `.omo/audit/`는 커밋에서 제외한다. PR 병합·배포는 수행하지 않는다. |

Bun 1.3.13의 기준은 전체 평균이 아닌 각 파일의 함수·줄 비율을 비교한다. [해당 버전의 판정 코드](https://github.com/oven-sh/bun/blob/bf2e2cecf27e800962b1e7f03d66278f9d5d2e79/src/sourcemap/CodeCoverage.zig#L127-L136)와 [종료 코드 결정](https://github.com/oven-sh/bun/blob/bf2e2cecf27e800962b1e7f03d66278f9d5d2e79/src/cli/test_command.zig#L2020-L2026)을 확인했다. 미달 항목의 예는 `B/src/services/export-render-session.ts` 함수 78.13%/줄 97.01%, `F/src/views/DesignSystemView.tsx` 16.67%/18.07%다. 별도 Node/브라우저 smoke의 실행률을 Bun 단위 테스트 coverage에 더하지 않았다.

앞선 실행의 1,001 pass·25 fail·2 errors와 1,033 pass·1 fail·1 error는 수정 근거로 보존했다. 전자는 proxy 환경·CLI 격리·link fixture·GC/CAS·실제 폰트/render 경계를, 후자는 복구 테스트 DB 격리와 관찰하지 않은 PDF Promise를 수정한 뒤 재실행했다. 기존 `coverage = false`가 이 Bun 버전에서 CLI 측정을 비활성화하는 현상도 작은 테스트로 확인해 제거했으며, 최종 수치는 실제 coverage 표가 출력된 실행이다.

## 보존한 경계

launch capability와 Host/Origin 검증, strict/versioned DTO, revision/digest CAS, staged publication, 비공개 첨부 경로, immutable visual reference, canvas의 source/tag 검증과 same-origin 미부여를 유지한다. 원본 ignored review와 기존 audit 자료는 수정하지 않는다. 테스트용 profile과 소유한 fixture 서버·프로세스만 사용하며, 로컬 fixture 통과를 실제 사용자 데이터·외부 공급자·실서비스 검증 완료로 바꾸어 표현하지 않는다.
