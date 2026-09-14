# WINDOWS DESKTOP SHELL KNOWLEDGE BASE

## OVERVIEW

WinForms + WebView2 host (`Program.cs`, 431 LOC) that owns the packaged backend process and the Velopack update lifecycle; earned this guide at score 8 as the repository's only C#/.NET surface, with a toolchain and process contract nothing else documents.

## STRUCTURE

```text
packages/desktop-windows/
├── Program.cs                  # Main + DesktopWindow + Native interop
├── BurnGuard.Desktop.csproj    # WinExe, net48, x64, <Version> must match APP_VERSION
├── app.manifest                # asInvoker, PerMonitorV2 DPI
└── qa/UpdateChecks.csproj      # separate update-check project; excluded from the app compile
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Startup order | `Program.Main` | Velopack (`SetAutoApplyOnStartup(false)`) → profile resolve → single-instance mutex → pending update → window |
| Single instance | `Program.Main` | Mutex `Local\BurnGuard.<identity>`; identity = 24 hex chars of SHA-256 over the uppercased absolute profile path; second launch posts the registered activate message and exits 0 |
| Backend ownership | `DesktopWindow.StartService` | Spawns `service/burnguard-design.exe` with `BG_DESKTOP=1`, `BG_NO_OPEN=1`, `BG_DEV=0`, `BG_PORT`; `BG_SCAN_PORT` removed; kill-on-close job object |
| Readiness protocol | `StartService` stdout handler | Only `[burnguard-desktop] ` JSON lines with `protocol == 1`, matching `pid`, and `url == http://127.0.0.1:<port>` are accepted |
| WebView hardening | `DesktopWindow` init | DevTools, accelerator keys, status bar, web messages, host objects, autofill all disabled; `PermissionRequested` always denied |
| Navigation policy | `IsTopLevelAppRoute`, `NewWindowRequested`, `OpenExternal` | Top-level navigation stays on the app origin; external links require absolute `http(s)` with empty `UserInfo` and open in the default browser |
| Smoke mode | `Program.Main`, `DesktopWindow` | Exactly `--smoke-test --smoke-report <absolute path>` plus an isolated `BG_APP_ROOT`; writes `{ ok, startupElapsedMs, servicePid, webViewVersion, screenshot, dom }` |
| CI update checks | `qa/UpdateChecks.csproj` | `dotnet run --project ... -c Release` in `windows-release.yml` |

## CONVENTIONS

- Build through the Bun scripts, not the IDE: `bun run build:windows` (needs a Windows host with the .NET 8 SDK) and `bun run build:windows:release` (Velopack `vpk pack`).
- `<Version>` in the csproj is stamped from `APP_VERSION` in `@bg/shared`; changing one without the other ships a mismatched installer.
- `qa/**/*.cs` is excluded from the app compile - the QA project is built separately.
- User-facing dialog text is Korean; diagnostics go into the smoke report, never into a dialog.
- `packages/desktop-mac/main.swift` mirrors this shell's readiness protocol and smoke contract; change both together.

## ANTI-PATTERNS

- Do not surface raw backend stdout/stderr in dialogs; it can carry private absolute paths. Both pipes are drained regardless.
- Do not re-enable DevTools, host objects, or `IsWebMessageEnabled` outside the smoke path, and do not relax the readiness message validation.
- Do not allow top-level navigation to `/api/` or `/runtime/`; sandboxed canvas iframes are deliberately unaffected by `NavigationStarting`.
- Do not apply or schedule an update before the owned backend and its job object have stopped; never force-exit active work.
- Do not start the backend without the kill-on-close job object, or leave `BG_SCAN_PORT` in the child environment.
