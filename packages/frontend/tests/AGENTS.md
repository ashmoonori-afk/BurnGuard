# FRONTEND TESTS KNOWLEDGE BASE

## OVERVIEW

46 `bun:test` suites (4,243 LOC) plus browser fixtures, held at package level rather than beside sources; earned this guide at score 8 for file count and a harness contract distinct from the `src` guides.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Transport/authority | `client.test.ts` | `apiFetch`, `authorizedFetch`, `bootstrapApiAuthority`; in the CI security list |
| Artifact sandbox | `artifact-csp.test.ts` | `buildSandboxedArtifactSrcDoc` CSP guarantees; in the CI security list |
| Real-browser behavior | `*.browser.test.ts` | `canvas-css-imports`, `deck-sandbox`; launch Chromium and need real opaque-iframe semantics |
| Browser page sources | `fixtures/*-browser.ts(x)` | Documents loaded by the browser suites; not test files themselves |
| Creation flows | `project-creation.test.ts` (292), `graphic-project-creation.test.ts` (278) | Largest suites; cover `@/lib/project-creation` |
| Localization | `i18n-locale.test.ts`, `i18n-messages.test.ts` | Locale resolution and pack key/locale completeness |
| Canvas/mode logic | `canvas-*.test.ts`, `tweak-review`, `side-input`, `selection-bridge`, `quick-comment` | Assert the pure helpers behind canvas overlays |

## CONVENTIONS

- Filename states the contract under test (feature or state name), not the source file path; suites import production symbols through `@/` and `@bg/shared`.
- Test prose follows Given/When/Then; files use CRLF, matching `.gitattributes`.
- `bunfig.toml` preloads `scripts/test-preload.ts` for every run: a disposable `BG_APP_ROOT`, migrations, and owned cleanup. Never point a test at a real `~/.burnguard`.
- Browser coverage is opt-in by filename suffix; on Windows a Chromium launch must not block the Bun event loop, so browser suites stay isolated from the plain suites.
- Async assertions subscribe to the exact event, promise, or store change first, then trigger the action; the shared timeout is 30,000 ms.

## ANTI-PATTERNS

- Do not use fixed sleeps, `waitForTimeout`, or poll loops to "let state settle".
- Do not import backend modules here; a test asserts the composer path stays free of them.
- Do not assert on prose or translated copy text; assert on `MessageKey`s, codes, and parsed values.
- Do not skip or delete a failing suite to get a green run, and do not weaken a security suite to accommodate a change.
- Do not write into the repository from a test; everything mutable belongs under the preload's temporary app root.

## COMMANDS

```bash
bun test packages/frontend/tests/<name>.test.ts --timeout 30000
bun test --coverage --timeout 30000     # root threshold 0.8
```
