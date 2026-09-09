# Windows native app — 2026-09-09

BurnGuard now opens in a Windows x64 WinForms window using Evergreen WebView2. React remains the UI, with the existing Bun backend as a hidden owned process. This is a native desktop host for the existing workspace; the editor is still rendered by WebView2.

## Build and run

Build prerequisites: Windows, Bun, Node, Git, and .NET 8 SDK. NuGet restores the pinned WebView2 SDK and .NET Framework 4.8 reference assemblies.

```powershell
bun install --frozen-lockfile
bun run build:windows
```

Run `dist/windows-native/BurnGuard.exe`. Distribute the entire `dist/BurnGuard-0.4.0-windows-x64.zip`, not the executable alone. The launcher needs Windows 10/11 x64, .NET Framework 4.8, and the shared WebView2 Runtime. Missing WebView2 produces an installation message. The portable archive requires no administrator installation.

The launcher is approximately 90 KB, with a roughly 103 MiB archive / 272 MiB extracted payload. `dist/windows-native-build.json` records exact bytes. The app reuses the system WebView2 browser; Bun, the Node renderer bridge, and design assets account for most of the package. Release UI source maps and non-x64 WebView2 loaders are excluded. Existing Chromium/Edge rendering and Python document-import prerequisites remain unchanged.

## Lifecycle and boundaries

- The window holds a per-profile mutex and activates the existing window on repeated launch.
- Both new Windows web and native servers hold an exclusive named pipe derived from the canonical profile path before bootstrap. This rejects concurrent use of the same profile across different ports; Windows releases ownership after process exit or a crash. Older builds do not participate in this lock.
- The backend uses `127.0.0.1:14070`; `BG_PORT` supports an explicit isolated profile during QA. An occupied port is rejected before migrations or recovery. Stop older browser-mode servers before launching.
- Readiness arrives over the owned child's stdout, with protocol version, expected process ID, and exact loopback URL. Shutdown uses the parent's private stdin pipe; no HTTP shutdown endpoint is exposed.
- Closing the window interrupts active work and closes registered rendering browsers. A Windows Job Object cleans up the owned process tree after the bounded graceful shutdown or an unexpected host exit.
- Existing launch capability, Host/Origin checks, and canvas sandbox remain enforced. Top-level navigation stays on the app origin; explicit external HTTP(S) links open in the default browser. Top-level `/api/` and `/runtime/` paths are blocked so project-controlled backend file responses never render as app-origin documents. No production host-object or web-message bridge is exposed.
- Project data remains in `%USERPROFILE%\.burnguard`. Production WebView state is separate under `%LOCALAPPDATA%\BurnGuard\WebView2`; smoke tests keep their WebView cache inside the isolated test profile.

## Verification

```powershell
bun run typecheck
bun test packages/backend/tests/desktop-lifecycle.test.ts
node scripts/qa/windows-native-smoke.mjs
node scripts/qa/package-smoke.mjs
bun run lint
```

The real native smoke relocates the complete app to a Korean path containing spaces, exercises an occupied port without database creation, opens the actual WebView2 UI, changes a model and verifies React retains it, verifies LOW and vanilla defaults, captures the rendered view, then checks that the owned backend exits and releases its port. Evidence is written under ignored `.omo/evidence/windows-native-2026-09-09/`.

The local WebView2 runtime used for this verification is 152.0.4191.66. Native Release compilation and the repository typecheck passed. The three lifecycle tests passed; the native smoke passed all three checks. The browser-mode portable smoke passed six checks, including Three.js roundtrip and bundled Node renderer discovery. No external AI requests are made by native QA.

The app was also opened with the existing local profile after stopping idle development servers. The visible native window and owned engine were verified; a second launch activated that one window. Its API returned two Claude models and seven Codex models. This verifies model discovery and selection, without claiming a new live generation/export run.

This is an unsigned portable app. An installer, signing, auto-updates, tray/background operation, Windows ARM64, and clean-machine compatibility are outside this delivery. Existing broad browser tests are not presented as a fresh native verification of every editing/export workflow.

Microsoft references: [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution), [pinned SDK package](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4191.47).
