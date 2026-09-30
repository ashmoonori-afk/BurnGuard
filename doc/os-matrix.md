# Per-OS matrix

BurnGuard ships for macOS arm64 and Windows x64 and is developed on Linux. One shared code path is the rule; an
OS-specific branch exists only where the OS behaves differently, and each branch is pinned by a test that injects the
platform (or by a suite that self-skips with a stated reason).

CI: `security.yml` runs on Ubuntu (the Linux column); `os-tests.yml` runs the platform-sensitive suites on `macos-14`
(arm64) and `windows-latest`; the release workflows run the native smokes on their own OS. The last column says which
jobs run each pinning suite.

## Areas

| Area | macOS arm64 | Windows x64 | Linux | Pinned by | Runs in |
|------|-------------|-------------|-------|-----------|---------|
| Chromium launch | Node bridge child, capability probe | Node bridge child (in-process launch freezes Bun) | same as macOS | `chromium-node-launch` | Ubuntu (opt-in smoke); Windows job; `chromium-capability` runs in no workflow |
| Local fonts | `osascript` JXA family list | PowerShell family list | `fc-list` | `local-fonts` (runs the host command) | OS jobs |
| Path containment | case-sensitive compare, keeps the public `/var` spelling of `/private/var` roots | lower-cased compare, drive and UNC rejection | case-sensitive | `path-boundary` | Ubuntu, OS jobs |
| Profile ownership | POSIX exclusive lock | named pipe | POSIX exclusive lock | `desktop-lifecycle` | OS jobs, `windows-release.yml` |
| File modes | `chmod` 0700/0600 | skipped | `chmod` | `trace-security`, `config-storage` | Ubuntu, OS jobs |
| Process trees | detached group | job object, no detached group | detached group | `owned-process-tree`, `owned-process-windows` | `owned-process-tree`: Ubuntu, OS jobs; `owned-process-windows` and the native process host checks: Windows job |
| Native canvas binding | `darwin-arm64` package | `win32-x64-msvc` package | host package | `native-binding` | Ubuntu, OS jobs |
| Text encoding hints | none | UTF-8 reminder block | none | `prompt-builder` (platform injected) | Ubuntu, OS jobs |
| Multi-format export (PDF, PNG, PPTX render) | real Chromium render | real Chromium render | real Chromium render | `exports` (`BG_EXPORT_SMOKE=1`) | OS jobs; Ubuntu opt-in only |
| Design-system outputs (wireframe SVG, starter stylesheet and skeleton) | byte-identical | byte-identical | byte-identical | `os-portability` (pinned digests) | Ubuntu, OS jobs |
| Stage paths with spaces and non-ASCII characters | supported | supported | supported | `os-portability` | Ubuntu, OS jobs |
| CRLF entrypoints | fresh-page and measured-page checks unaffected | unaffected | unaffected | `os-portability` | Ubuntu, OS jobs |
| Failure text in design-system API errors and the export job `error_message` | fixed copy plus a domain error code; no `/Users/...` path, no errno text | same; no drive-letter or UNC path | same; no `/home/...` path | `design-system-route-error-bodies`, `export-failure-message` (path flavor injected) | Ubuntu, OS jobs |

## Known gaps

- Windows terminate race, fixed: an owned job whose target exits while the terminate helper starts used to make
  `terminateOwnedWindowsJob` throw "Owned process host could not prove process cleanup" (reason `helper_failed`,
  helper exit 201). The launcher's exited receipt now proves the cleanup (`owned-process-windows.ts`), pinned by the
  "Windows owned host when the helper fails after the launcher has already exited" tests (injected stubs, every OS)
  and by the Windows-only exit-timing sweep in `owned-process-windows.test.ts`.
- Windows launcher exited receipt, fixed: the launcher used to replace its running `launch.json` with the exited
  receipt through `File.Replace`. On CI runners that failed with `ERROR_UNABLE_TO_REMOVE_REPLACED` (0x80070497) right
  after a short-lived target exited, because another handle to the file was still open without delete sharing; the
  launcher exited with 206 and the backend reported `invalid_receipt`. The exited receipt is now written once to its
  own file (`launch.exited.json`) and no receipt is ever replaced. `invalid_receipt` from launch settlement carries the
  launcher's exit code (204 cleanup timeout, 205 incomplete, 206 receipt write), and a receipt write failure prints its
  HRESULT on the host's stderr. The launcher also re-reads the job's active process count instead of relying only on
  the `JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO` completion message, whose delivery Windows does not guarantee.
- Chromium popup and WebSocket smokes, fixed: the tests passed `AbortSignal.timeout(20000)` to
  `launchChromiumViaNode`, which closes the browser whenever its signal aborts. On slower Windows runners the browser
  was closed 20 s after launch, mid-test. The tests now keep the signal alive while they use the browser; a cold system
  Chrome launch measured 3.8-7.1 s and a warm one about 0.6 s on `windows-latest`.
- Windows `local-fonts`, fixed: the first Windows PowerShell start loads .NET Framework and System.Drawing cold. A warm
  enumeration takes about 0.3 s; cold starts took 1-9 s on `windows-latest` and crossed the old 10 s limit under load.
  The limit is 25 s.
- The suites above gate the Windows job; the former non-gating "Windows flaky watch" job is gone. Their stability was
  shown by a temporary 12-way repeat of the Windows job before merge (PR #177).
- Browser-backed suites (real Chromium measurement, screenshots, the visual diff, crops and the design audit: the
  design-system pages, conformance, contrast and starter suites) run on the macOS and Windows jobs with
  `BG_BROWSER_SMOKE=1`.
- Long paths on Windows (over 260 characters) are not exercised; stage paths stay short by design.
- File locking on Windows: a crop or asset overwrite can fail with EBUSY or EPERM while another process holds the
  file. Review crops are report-only: `withSectionCrops` catches any write error and returns the target without
  crops, so the turn is unaffected. Other writers are not guarded against this.
- Case-insensitive file systems (macOS, Windows): hero and logo image names that differ only by case are one image on
  every OS (the first wins), at extraction and when a saved pin is read, so extraction does not depend on the file
  system's case rules.
- Fonts and DPI: measurements and reference screenshots come from the extracting machine's installed fonts at device
  scale factor 1; SSIM comparisons are only meaningful between renders made on the same machine.
