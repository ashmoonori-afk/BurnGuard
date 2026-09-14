# AUTOMATION KNOWLEDGE BASE

## OVERVIEW

Root build, development, and packaging orchestration across Bun, .NET 8, and Swift toolchains; earned this guide at score 10 for 8 executable root scripts (811 LOC) plus the QA tree and a distinct command domain. The 65-file QA harness under `qa/` has its own guide.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Launch local stack | `dev-launcher.ts` | Backend health on `127.0.0.1:14070` gates Vite `5173`, then browser open |
| Build backend binary | `build-binary.ts` | `bun build --compile` Windows x64 plus staged runtime assets |
| Stage runtime assets | `package-runtime.ts` | `isRuntimeSource`/`stageRuntimeAssets`; ships `design system themes/`, `design system sample/` (minus `uploads/`), `samples/original/`, fonts, migrations, LICENSE, NOTICE |
| Windows shell + release | `build-windows-native.ts`, `package-windows-release.ts` | .NET 8 SDK builds the `net48` csproj; WebView2 + Velopack `vpk pack`; Windows host required |
| macOS app, DMG, release | `build-mac.ts`, `package-mac-release.ts` | macOS-gated; needs `build:frontend` first |
| Test bootstrap | `test-preload.ts` | `bunfig.toml` preload: temp `BG_APP_ROOT`, migrations, owned cleanup |
| QA acceptance harness | `qa/` | Evidence receipts, browser fixtures, HTTP scenarios - see `qa/AGENTS.md` |

## CONVENTIONS

- Every root script is an executable Bun module with a shebang and top-level `await`; run it from the repository root unless it documents otherwise.
- Resolve roots from `import.meta.dir`, never from the caller's working directory.
- Bound every child process and readiness wait; kill timed-out children and clear deadline timers in `finally`.
- Stage build artifacts deterministically under `dist`, and reject a run whose required SDK, tool, or staged resource is missing instead of producing a partial package.
- Platform packaging is gated: Windows native needs a Windows host with .NET 8, macOS packaging needs macOS.
- Preserve LF for shell scripts and CRLF for Windows command launchers as configured by `.gitattributes`.

## ANTI-PATTERNS

- Do not gate on arbitrary sleeps; wait on health, readiness lines, or process exit with a bounded deadline.
- Do not print tokens, provider output, absolute private paths, or unsanitized environment values.
- Do not report a step as succeeding when a prerequisite was skipped or unmeasurable.
- Do not write build output outside `dist`/staging roots, and do not mutate tracked source from a build script.
- Do not hardcode developer-machine paths; every path derives from the resolved repository root.
- Do not invoke macOS packaging during ordinary Windows validation, or vice versa.
