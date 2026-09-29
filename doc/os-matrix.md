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
| Multi-format export (PDF, PNG, PPTX render) | real Chromium render | real Chromium render | real Chromium render | `exports` (`BG_EXPORT_SMOKE=1`) | macOS and Windows jobs; Ubuntu runs it opt-in only |
| Design-system outputs (wireframe SVG, starter stylesheet and skeleton) | byte-identical | byte-identical | byte-identical | `os-portability` (pinned digests) | Ubuntu, OS jobs |
| Stage paths with spaces and non-ASCII characters | supported | supported | supported | `os-portability` | Ubuntu, OS jobs |
| CRLF entrypoints | fresh-page and measured-page checks unaffected | unaffected | unaffected | `os-portability` | Ubuntu, OS jobs |

## Known gaps

- Windows flakes seen in CI (2 of the last 8 Windows job runs, both times together on the same run): `local-fonts`
  "host installed fonts" hits the 10 s PowerShell timeout in `getLocalFonts` (a cold PowerShell start; the same limit
  means a slow machine reports `local_fonts_unavailable`), and `owned-process-tree` "acquisition abort reaps its
  descendant (already aborted: false)" receives a tree-cleanup error instead of `ExtractionAcquisitionError` (the
  cleanup receipt could not be proven). Neither is root-caused. Both suites run in the non-gating "Windows flaky watch"
  job so the signal stays visible; the reap case looks like a real race in Windows tree cleanup and needs a real
  Windows session to settle.
- Browser-backed suites (real Chromium measurement, screenshots, the visual diff, crops and the design audit: the
  design-system pages, conformance, contrast and starter suites) run on the macOS and Windows jobs with
  `BG_BROWSER_SMOKE=1`. The `chromium-node-launch` popup and deck-runtime smoke failed once on Windows ("Chromium
  connection aborted" after 23 s) and passed on the sibling run; it runs in the non-gating Windows flaky watch job.

- Long paths on Windows (over 260 characters) are not exercised; stage paths stay short by design.
- File locking on Windows: a crop or asset overwrite can fail with EBUSY or EPERM while another process holds the
  file. Review crops are report-only: `withSectionCrops` catches any write error and returns the target without
  crops, so the turn is unaffected. Other writers are not guarded against this.
- Case-insensitive file systems (macOS, Windows): two extracted hero images whose names differ only by case share one
  file on disk. Staging verifies size and digest, so the loser is skipped, never mixed.
- Fonts and DPI: measurements and reference screenshots come from the extracting machine's installed fonts at device
  scale factor 1; SSIM comparisons are only meaningful between renders made on the same machine.
