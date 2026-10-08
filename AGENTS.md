# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-14T00:12:24.061Z
**Commit:** 74cd86c
**Branch:** main

## OVERVIEW

BurnGuard is a local-first Bun workspace monorepo: Hono/SQLite backend, React 18 + Vite SPA, versioned contracts in `@bg/shared`, and two native desktop shells (C# WinForms/WebView2, Swift AppKit/WKWebView) that run the backend as a child process.

## STRUCTURE

```text
BurnGuard/
├── packages/
│   ├── backend/           # Hono server, SQLite/Drizzle, harness, adapters, security, services (+ tests/)
│   ├── frontend/          # Vite + React 18 SPA; api/components/views/lib/i18n (+ tests/)
│   ├── shared/            # @bg/shared, source-only ESM: 41-module barrel + 21 subpath exports
│   ├── desktop-windows/   # WinForms + WebView2 + Velopack shell; Program.cs is security-dense
│   └── desktop-mac/       # single Swift main.swift, same stdout readiness protocol
├── scripts/               # 8 root Bun scripts: dev launcher, binary/native builds, test preload
│   └── qa/                # 65-file evidence harness: receipts, static gate, Playwright fixtures
├── doc/                   # 13 tracked English-only design docs; numbered records 04-23 are local-only (doc/README.md)
├── docs/                  # separate 2-file tree: dated QA + security reports
├── samples/               # seeded corpus, 4 brands x 3 formats, staged by package-runtime.ts
├── design system themes/  # 10 bundled themes -> systems/builtin-theme-<slug>  (path has spaces)
├── design system sample/  # Northvale Capital reference system (uploads/ never committed)
├── .github/workflows/     # security (Ubuntu + guards), os-tests (macOS arm64, Windows x64), windows-release, macos-release
└── bunfig.toml            # preloads scripts/test-preload.ts for EVERY bun test
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Backend startup, shutdown, port policy | `packages/backend/src/AGENTS.md` | 11 domain subdirs; ordering and authority map |
| Artifact, extraction, export, research flows | `packages/backend/src/services/AGENTS.md` | 152 TS modules + `chromium-node-bridge.mjs`, ~17.7k LOC, no barrel |
| Schema, migration, recovery state | `packages/backend/src/db/AGENTS.md` | 39 modules + 14 forward migrations (`0001`-`0014`) + 4 templates |
| HTTP or SSE behavior | `packages/backend/src/routes/AGENTS.md` | 17 Hono modules + 3 `*-input.ts` parsers + thumbnail handler |
| Capability, path containment, body caps | `packages/backend/src/security/AGENTS.md` | Request authority, raw-file headers, agent-control detection |
| Prompt or context assembly | `packages/backend/src/harness/AGENTS.md` | Bounded summaries, 6 shipped skills, `assets/lucide/` |
| Claude Code/Codex execution | `packages/backend/src/adapters/AGENTS.md` | Subprocess + stream normalization; argv in `codex/index.ts` |
| Backend test isolation, smoke gates | `packages/backend/tests/AGENTS.md` | 229 Bun suites, ~34.3k LOC, platform skips |
| Frontend package, providers, dev proxy | `packages/frontend/AGENTS.md` | Provider order, counts, i18n wiring |
| Feature UI or canvas bridge | `packages/frontend/src/components/AGENTS.md` | 107 files / 14 feature folders; canvas sandbox |
| Route compositions | `packages/frontend/src/views/AGENTS.md` | 5 views, 3,435 LOC; `ProjectView` invariants |
| Browser API calls | `packages/frontend/src/api/AGENTS.md` | `client.ts` authority + envelope rules |
| Pure frontend helpers | `packages/frontend/src/lib/AGENTS.md` | 20 modules; per-module "never" rules |
| Copy, locales, message keys | `packages/frontend/src/i18n/AGENTS.md` | ko/en/zh-CN typed registry; `useT` in ~75 modules |
| Frontend test setup | `packages/frontend/tests/AGENTS.md` | 46 `bun:test` suites + browser fixtures |
| Shared DTO or parser changes | `packages/shared/src/AGENTS.md` | 42 contract modules; 41-module barrel + subpaths |
| Windows shell, updates, readiness | `packages/desktop-windows/AGENTS.md` | WinForms/WebView2, Velopack, kill-on-close job |
| macOS shell | `packages/desktop-mac/AGENTS.md` | Swift WKWebView mirror of the Windows contract |
| Build, packaging, launch scripts | `scripts/AGENTS.md` | Root scripts only; runtime staging list |
| QA evidence automation | `scripts/qa/AGENTS.md` | Sanitized digests, static gate, isolated `QA_HOME` |
| Design records, ADRs | `doc/AGENTS.md` | English-only; dated records supersede; append-only ADRs |
| Seeded sample corpus | `samples/AGENTS.md` | 4 brands x 3 formats; path contract |
| Bundled themes | `design system themes/AGENTS.md` | 10 themes; slug registry + token/provenance contract |
| Reference design system | `design system sample/AGENTS.md` | Northvale Capital; `uploads/` privacy guard |

## CODE MAP

| Symbol/domain | Type | Location | Consumers | Role |
|---------------|------|----------|-----------|------|
| Backend entry chain | Lifecycle | `backend/src/index.ts` -> `bootstrap.ts` -> `server.ts` | Local server | Startup/ordered shutdown; migrate, seed, reconcile, watch; `createApp` + `classifyApiRoute` lazy dispatch + SPA serving |
| Shared contract barrel | Contract boundary | `shared/src/index.ts` | Backend + frontend | 41 modules, 21 subpaths; only DTO authority |
| Durable repositories | Persistence boundary | `backend/src/db/` | Backend workflows | Conditional transitions and recovery authority |
| Route/event layer | HTTP/SSE boundary | `backend/src/routes/` | Frontend client | Validation, envelopes, status, event publication |
| Security seam | Authority | `backend/src/security/` | All non-health routes | Capability check, `resolveWithin`, body caps |
| Frontend entry chain | Composition | `frontend/src/main.tsx` -> `App.tsx` | SPA | `Bootstrap` -> `QueryClientProvider` -> `BrowserRouter`; routes `/`, `/projects/:id`, `/systems/:id`, `/settings` |
| Typed browser client | API boundary | `frontend/src/api/client.ts` | React UI | Carries launch capability by resource |
| Canvas bridge | Sandbox protocol | `frontend/src/components/` | Canvas iframe | Tagged `postMessage` exchange |
| Desktop shells | Process host | `desktop-windows/Program.cs`, `desktop-mac/main.swift` | Packaged app | Readiness protocol, mutex, job object, nav limits |
| Test preload | Harness | `scripts/test-preload.ts` | Every `bun test` | Temp `BG_APP_ROOT` + migrate + cleanup |

## CONVENTIONS

- Startup order is contractual: migrate, seed/bootstrap, lifecycle reconciliation, then the HTTP listener and readiness line, then watchers (in the background, a few projects at a time; artifact mutations wait for their project's first observation). Shutdown stops intake, stops watcher startup and closes watchers, interrupts owned turns, closes registered Chromium instances, then forces server stop.
- Backend binds `127.0.0.1`, canonical port `14070`; port scanning is opt-in via `BG_SCAN_PORT=1`; one process per profile (`profile-ownership.ts`: Windows named pipe, POSIX exclusive SQLite lock on `<profile>/.profile.lock`).
- `@bg/shared` (snake_case fields) is the only transport authority; backend routes and frontend api/types never redeclare DTO shapes. Typecheck `packages/shared` before its consumers.
- Envelopes: success `{ data, meta? }`, failure `{ error: { code, message, details? } }`. `/api/health` is public; `/api/bootstrap` GET same-origin mints the per-launch capability (32 random bytes, `HttpOnly SameSite=Strict` cookie + `x-burnguard-capability`, `timingSafeEqual`); unknown `Host` -> 421, else 403. Body caps 1 MiB JSON / 4 MiB draws / 64 MiB listed multipart -> 413.
- SQLite rows + canonical filesystem receipts (canonical JSON, SHA-256 digest, revision, owner) are durable authority; in-memory locks, watcher suppression, and browser registries are not. Mutations run prepare/stage/validate/publish/commit with rollback or startup recovery.
- Every `MessageKey` needs `ko` + `en` + `zh-CN`. First run follows the OS language (Korean -> `ko`, Simplified Chinese -> `zh-CN`, otherwise `en`); an explicit Settings choice wins and persists. `@/lib/error-copy` maps backend error codes to keys.
- Desktop readiness: backend prints `[burnguard-desktop] {protocol:1,pid,url}`; shells validate protocol/pid/url before showing a window and run it with `BG_DESKTOP=1 BG_NO_OPEN=1`.
- `APP_VERSION` in `@bg/shared/app`, `BurnGuard.Desktop.csproj` `<Version>`, and the Velopack package move together.
- Run `bun test` from the repo root: `bunfig.toml` preload mints a throwaway `BG_APP_ROOT` (must be absolute), migrates it, deletes it at exit (timeout 30000, coverage 0.8). Tests use Given/When/Then descriptions and injected seams.
- `packages/backend/tsconfig.json` includes `src` only; backend tests are typechecked only by root `tsc --build`.
- `doc/` is English-only (`CONTRIBUTING.md:171`); dated `doc/NN-...-YYYY-MM-DD.md` records supersede numbered specs.

## ANTI-PATTERNS (THIS PROJECT)

- Never launch Chromium in-process on the Bun event loop — it freezes the whole backend on Windows. Browser work goes through `chromium-node-bridge.mjs` (Node child after a child-process probe), the QA harness, or `*.browser.test.ts`.
- Never join user/DB path fragments by hand; use `resolveWithin` / `resolveManagedPath`.
- Never render or log raw backend/provider diagnostics, absolute private paths, tokens, or the launch capability — not in API errors, dialogs, toasts, receipts, prompt context, or native shells. Backend messages are never shown raw to users; map through `error-copy`.
- Never bypass launch-capability checks outside `/api/health`, and never permit mutations without owned host/origin authority.
- Never edit an applied migration — add a lexically later one.
- Never grant the canvas iframe same-origin; artifacts are `sandbox="allow-scripts allow-popups"`, `systems/PreviewIframe.tsx` is the single deliberate exception. Untagged messages without strict `event.source` checks are not trusted.
- Never use fixed sleeps, `waitForTimeout`, or blind polling in tests or scripts — subscribe to the event and await under a bounded deadline. `scripts/qa/task-8-gates.sh` statically rejects sleeps, `as any`, `@ts-ignore`, and debug logging.
- Never pin prompt or UI prose in tests; assert sentinel tags and parsed fields.
- Never enable `BG_UPLOAD_SMOKE` / `BG_BROWSER_SMOKE` / `BG_EXPORT_SMOKE` by default; they stay opt-in.
- Never commit to `design system sample/uploads/`; never add CDN fonts, icons, or charts to themes, samples, or generated output.
- Never overwrite immutable visual-reference underlays or copy their original bytes into authored output.
- Never combine generation skills when one project-specific deck, prototype, or diagram skill should be selected.

## UNIQUE STYLES

- Shell QA preflights required tools and emits sanitized machine-readable evidence, pinning repository identity to `main` and an expected base commit.
- Desktop shells speak one prefixed-JSON stdout protocol (`[burnguard-desktop]`, protocol 1) for readiness and smoke-test reports.
- Bundled assets are staged by path convention, read by backend code and `scripts/package-runtime.ts`: `design system themes/<slug>` -> `systems/builtin-theme-<slug>` (slug must exist in `backend/src/data/bundled-design-systems.ts`); `design system sample/` -> `systems/northvale-capital` minus `uploads/`; `samples/original/<slug>/{web,slides,graphic,assets}` keyed by `original-samples.ts`. Two of those directories contain spaces — always quote them.

## COMMANDS

```bash
bun run dev                    # launcher: backend health (127.0.0.1:14070) gates Vite (5173)
bun run dev:backend            # BG_DEV=1 bun run --watch src/index.ts
bun run typecheck              # tsc --build across the workspace
bun test                       # root only; preload isolates BG_APP_ROOT (timeout 30000)
bun test packages/backend/tests/<file>.test.ts
bun run build                  # frontend + scripts/build-binary.ts; the backend step needs a Windows x64 host
bun run build:windows:release  # Windows host, .NET 8, vpk 1.2.0
bun run build:mac:dmg          # macOS host only
bun run lint                   # git diff --check
bun scripts/qa/preflight.ts --json
node scripts/qa/e2e-smoke.mjs [--only core]
bash scripts/qa/task-8-gates.sh
bunx tsc -p scripts/qa/tsconfig.json --noEmit
bun scripts/qa/check-os-matrix-coverage.ts   # every test file is in os-tests.yml or the shrink-only baseline
bun scripts/qa/check-flake-patterns.ts       # launch-path flake patterns in packages/backend/src
```

## NOTES

- Managed roots derive from `BG_APP_ROOT` (default `~/.burnguard`); canonical artifact trees exclude `.meta`, `.attachments`, `.burnguard-inputs`, `.git`, `.omc`, `.claude`.
- Symlink-dependent cases self-skip via `tests/helpers/platform.ts` on Windows without Developer Mode.
- Pinned deps constrain exports: `playwright-core` 1.59.1, `pdfjs-dist` 5.4.149, `@napi-rs/canvas` 0.1.100, `pdf-lib` 1.17.1. CI pins Bun 1.3.14 with frozen installs.
- Native packaging is host-gated: Windows needs .NET 8 + `.config/dotnet-tools.json` Velopack pin; macOS DMG needs macOS.
- `upload-extractor-py.ts` embeds a Python extractor in `String.raw` — no backticks, no `${`.
- Largest backend files: `services/design-system-extract.ts` (2,165), `db/seed-tutorials.ts` (985), `tests/design-system-extract.test.ts` (634), `routes/session.ts` (606).
- Vite uses strict port `5173`, proxies `/api` and `/runtime`, and sends `frame-ancestors 'none'` + `X-Frame-Options: DENY`. Windows is the primary local target; macOS packaging and shell QA are also present.
- Consult the nearest nested `AGENTS.md` before changing a delegated domain; this root records only cross-package constraints.
- Doc drift to ignore: `CONTRIBUTING.md` cites a `test:e2e` script and `tests/e2e/` that do not exist (QA lives in `scripts/qa/`); `doc/README.md` advertises `ref/` and `devplan/` (gitignored, absent in a checkout) and still allows Korean. `uploads/`, `ref/`, `devplan/`, `/.omo/` are gitignored. A stray empty `NUL` file sits at the repo root (Windows artifact).

## CI FAILURES AND OS COVERAGE

- An OS-specific or intermittent CI failure is a product bug until a root cause proves otherwise. "Runner problem" is a conclusion that needs evidence, never a starting assumption.
- One rerun at most. The second occurrence of the same failure anywhere gets a root-cause PR before anything else merges.
- A local Linux pass is not evidence for Windows or macOS. Only CI on the exact head is: confirm from the macOS arm64 and Windows x64 job logs that the new tests ran and show `(pass)`.
- Every new test file must run in the OS matrix: list it in `.github/workflows/os-tests.yml` (macOS and Windows) and in `.github/workflows/security.yml` (Ubuntu). `bun scripts/qa/check-os-matrix-coverage.ts` fails the Security job when a test file is in neither an `os-tests.yml` list nor `scripts/qa/os-matrix-baseline.txt`, when the baseline names a missing or already covered file, or when a workflow names a file that does not exist. The baseline lists the suites that were Linux-only on 2026-09-30; entries may only be removed (`--base-ref origin/main` rejects growth), and a new test never goes there.
- Never skip a test on one OS. Use the form that OS supports instead (a directory junction where a symlink needs privileges on Windows, an injected `path.win32`/`path.posix` flavor, an injected platform) and add explicit Windows-path and POSIX-path cases for anything that touches paths, separators, fonts, packaging, browser launch or file locks.
- `bun scripts/qa/check-flake-patterns.ts` fails the Security job on the launch-path patterns behind the 2026-09-30 failures: a raw `AbortSignal.timeout()` handed to a launch entry point instead of `AbortSignal.any([...])` or `keepAbortSignalArmed` (`packages/backend/src/lib/abort-signal.ts`), a Playwright-loading module that removes an abort listener without arming the signal, a Playwright `launch`/`launchServer`/`connect` call that relies on the library's `timeout` option, and `launchServer` outside `launchWithin`/`probeChannels`.
- Details, the per-OS table and the hardening log: `doc/os-matrix.md`.

## HARDENING

- 2026-09-30, browser launch in CI (PR #195, issues #192 and #196; log in `doc/os-matrix.md`). Windows: playwright-core 1.59.1 does not apply `launchServer`'s `timeout`, a probe stopped at its deadline was cached as "no browser" for ten minutes, and only Playwright's own build counted as installed. macOS: Bun 1.3.14 cancels the timer of an `AbortSignal.timeout()` signal when its last abort listener is removed, so the caller's deadline never fired. Pinned by `chromium-launch-hardening`, `chromium-bridge-probe`, `chromium-capability`, `chromium-browser-paths` and `export-render-launch` on Ubuntu, macOS and Windows, and by the two guard scripts above. Same day, OS-coverage gap: the suites added by PRs #178 and #190 were named by no workflow and ran on Linux only; the coverage guard closes that.
- 2026-09-30, export closure reference scans (PR #200 and issue #201; log in `doc/os-matrix.md`). #200: `resolveStaticClosure` collected every reference of a file before applying the 10,000-reference cap, and the import inventory resolved every repeated value again, so a million-`url()` page took 21-27 s on Windows x64 and timed out once at 30.6 s; every collector now takes the remaining budget and stops one reference past it. #201: the CSS `url()` pattern in `packages/backend/src/services/export-closure.ts` was quadratic on a value that repeats `url(` without closing a reference (40,000 openers, 17.8 s on Linux), which the cap did not bound; `cssUrlValues` is now one forward pass, and `scriptReferences` takes the same budget. Issue #203 (2026-10-01): the textual import patterns `scriptReferences` falls back to for a script that does not parse were quadratic the same way (20,000 repeats of `import`, 12.1 s on Linux); `scriptImportValues` is now one forward pass. Pinned by `export-validation` on Ubuntu, macOS and Windows through counts, never time: the injected scan probe (references collected per file) and the character counts `cssUrlValues` and `scriptImportValues` return. Never scan untrusted project text with a pattern that can restart from every opener, and never collect references before the cap is applied.

## RELEASE UX QA STAGE

- Before the release security gate, run the pre-release app UX QA in `scripts/qa/prerelease-ux-qa.md` against the release candidate: a real browser on an isolated `BG_APP_ROOT`, journeys J01-J07 (extract, create, generate, review/repair, pin update, export, recover a failed turn), HAR plus screenshots, and a P0-P3 report.
- Mask every HAR with `bun scripts/qa/har-mask.ts <raw.har> <shared.har> --root <qa-home>=<qa-home>` before it leaves the run directory, then scan the masked file for provider diagnostics and user content the tool cannot recognise. It masks the capability (header, cookie, bootstrap body and every other place its value appears), authorization headers, cookies, secret-named params and body fields, and common home paths plus the given roots. It refuses to write output that still contains a collected secret, or when a bootstrap body carries no recognisable capability.
- Store the report and masked evidence under `.omo/evidence/release-<version>/ux-qa/`. An open P0 or P1 finding keeps the release unpublished unless the owner explicitly accepts it.

## RELEASE SECURITY GATE

- Before every release publication, run an independent security review with a GPT-5.6 or later model, as explicitly required by the user. Follow the established Daybreak review protocol below; Daybreak-specific model access is not required. Use low reasoning effort by default.
- Review the final release changes, relevant security boundaries and packaged artifacts. Save the reviewed commit/tree, scope, findings and validation evidence under an ignored `.omo/evidence/release-<version>/` directory.
- Resolve release-blocking findings and have the reviewer verify the fixes before publishing. A draft release or successful CI is not a substitute for this review. Record the reviewer model with the evidence. If an eligible reviewer is unavailable or the review is incomplete, keep the release unpublished and report the gate accurately.

