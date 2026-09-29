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
| Chromium launch | Node bridge child, capability probe | Node bridge child (in-process launch freezes Bun) | same as macOS | `chromium-node-launch` | Ubuntu (opt-in smoke); Windows flaky watch (non-gating); `chromium-capability` runs in no workflow |
| Local fonts | `osascript` JXA family list | PowerShell family list | `fc-list` | `local-fonts` (runs the host command) | macOS job; Windows flaky watch (non-gating) |
| Path containment | case-sensitive compare, keeps the public `/var` spelling of `/private/var` roots | lower-cased compare, drive and UNC rejection | case-sensitive | `path-boundary` | Ubuntu, OS jobs |
| Profile ownership | POSIX exclusive lock | named pipe | POSIX exclusive lock | `desktop-lifecycle` | OS jobs, `windows-release.yml` |
| File modes | `chmod` 0700/0600 | skipped | `chmod` | `trace-security`, `config-storage` | Ubuntu, OS jobs |
| Process trees | detached group | job object, no detached group | detached group | `owned-process-tree`, `owned-process-windows` | `owned-process-tree`: Ubuntu, macOS job, Windows flaky watch (non-gating); `owned-process-windows`: Windows job |
| Native canvas binding | `darwin-arm64` package | `win32-x64-msvc` package | host package | `native-binding` | Ubuntu, OS jobs |
| Text encoding hints | none | UTF-8 reminder block | none | `prompt-builder` (platform injected) | Ubuntu, OS jobs |
| Multi-format export (PDF, PNG, PPTX render) | real Chromium render | real Chromium render | real Chromium render | `exports` (`BG_EXPORT_SMOKE=1`) | macOS job; Windows flaky watch (non-gating); Ubuntu opt-in only |
| Design-system outputs (wireframe SVG, starter stylesheet and skeleton) | byte-identical | byte-identical | byte-identical | `os-portability` (pinned digests) | Ubuntu, OS jobs |
| Stage paths with spaces and non-ASCII characters | supported | supported | supported | `os-portability` | Ubuntu, OS jobs |
| CRLF entrypoints | fresh-page and measured-page checks unaffected | unaffected | unaffected | `os-portability` | Ubuntu, OS jobs |

## Known gaps

- Windows terminate race, fixed: an owned job whose target exits while the terminate helper starts used to make
  `terminateOwnedWindowsJob` throw "Owned process host could not prove process cleanup" (reason `helper_failed`,
  helper exit 201). The launcher's exited receipt now proves the cleanup (`owned-process-windows.ts`), pinned by the
  Windows sweep test in `owned-process-windows.test.ts`. Chromium closes, the export smoke and the `owned-process-tree`
  reap case all end in that call. They stay in the non-gating "Windows flaky watch" job until about ten consecutive
  Windows runs show the Export smoke step itself passing.
- Windows export smoke teardown, still open: after #174, one Windows watch run passed all nine export tests but failed
  an `afterAll` hook with `invalid_receipt` from `validateLaunchSettlement` (via `terminateBrowser`). The likely
  mechanism, not proven: a forced close that fails makes `controlWindowsJob` kill the launcher before it writes its
  exited receipt, so the later settlement throws and masks the original close failure. The helper's stderr code is not
  yet carried on the error, which is why the original cause is unknown.
- Windows `local-fonts` "host installed fonts" hit the 10 s PowerShell timeout in `getLocalFonts` in CI (a slow
  PowerShell start; the same limit makes a slow machine report `local_fonts_unavailable`). Not root-caused; the suite
  runs in the watch job.
- The `chromium-node-launch` popup and deck-runtime smoke failed on Windows ("Chromium connection aborted" after
  about 20 s) in roughly one of two watch runs. Not root-caused; it runs in the watch job.
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
