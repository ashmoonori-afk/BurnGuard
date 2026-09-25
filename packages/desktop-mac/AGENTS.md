# MACOS DESKTOP SHELL KNOWLEDGE BASE

## OVERVIEW

Single-file Swift `WKWebView` shell (`main.swift`, 287 LOC) that launches and owns the bundled backend; earned this guide at score 8 as the repository's only Swift surface, mirroring the Windows shell's process contract with a different toolchain.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Lifecycle | `BurnGuardAppDelegate` | `applicationDidFinishLaunching` → main menu → arguments → window → service; terminate waits for the backend to exit (`awaitServiceExit`, SIGKILL after 15 s because the backend handles SIGTERM as its own drain), then `finishTermination` replies |
| Argument contract | `parseArguments` | Only `["--smoke-test", "--smoke-report"]`; any other argument shape is rejected |
| Window/webview | `createWindow` | `WKWebViewConfiguration`, navigation delegate installed before the first load |
| Backend ownership | `startService` | `Process` rooted at `Bundle.main.bundleURL`, stdin/stdout/stderr pipes retained for drain and shutdown |
| Readiness protocol | `consumeServiceOutput` | Line-buffered; only `[burnguard-desktop] ` JSON with a matching `protocol` version and `url` is accepted |
| Navigation policy | `isAppURL`, `webView(_:decidePolicyFor:)`, `createWebViewWith`, `openExternal` | Host must equal the backend origin host; everything else is cancelled. Main-frame link clicks and `window.open` to absolute `http(s)` without userinfo open in the default browser, never in a second web view |
| Smoke report | `webView(_:didFinish:)`, `writeReport` | Evaluates page JS, records `title`/`bodyTextLength`, writes pretty JSON to the report path |
| Failure path | `fail` | Smoke run writes the failure into the report; interactive run shows an `NSAlert` |

## CONVENTIONS

- Built and bundled only by `scripts/build-mac.ts` / `package-mac-release.ts` (`bun run build:mac`, `build:mac:dmg`, `build:mac:release`); macOS host required, and `build:frontend` must run first.
- The `[burnguard-desktop] ` line protocol, the `BG_DESKTOP`/`BG_NO_OPEN` env contract, and the smoke-report shape are shared with `packages/desktop-windows/Program.cs` - change both shells together.
- Everything is one file on purpose: the shell holds no product logic, only window, process, navigation, and smoke concerns.
- Native verification runs through `scripts/qa/native-mac-smoke.ts`; `macos-release.yml` additionally runs the backend update tests.

## ANTI-PATTERNS

- Do not allow navigation to a host other than the resolved backend origin, and do not add a same-origin escape for previews.
- Do not print or alert raw subprocess output; it can contain private absolute paths.
- Do not exit before the service process is terminated and its pipes are drained.
- Do not add product features, UI chrome, or web-message channels to the shell; the SPA owns the UI. The standard App/Edit/Window main menu (`installMainMenu`) is OS keyboard integration, not chrome.
- Do not invoke macOS packaging from a Windows validation run.
