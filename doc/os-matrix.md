# Per-OS matrix

BurnGuard ships for macOS arm64 and Windows x64 and is developed on Linux. One shared code path is the rule; an
OS-specific branch exists only where the OS behaves differently, and each branch is pinned by a test that injects the
platform (or by a suite that self-skips with a stated reason).

CI: `security.yml` runs on Ubuntu; `os-tests.yml` runs the platform-sensitive suites on `macos-14` (arm64) and
`windows-latest`; the release workflows run the native smokes on their own OS.

## Areas

| Area | macOS arm64 | Windows x64 | Linux | Pinned by |
|------|-------------|-------------|-------|-----------|
| Chromium launch | Node bridge child, capability probe | Node bridge child (in-process launch freezes Bun) | same as macOS | `chromium-node-launch`, `chromium-capability` |
| Local fonts | `osascript` JXA family list | PowerShell family list | none (synthetic list) | `local-fonts` |
| Path containment | case-sensitive compare, keeps the public `/var` spelling of `/private/var` roots | lower-cased compare, drive and UNC rejection | case-sensitive | `path-boundary` |
| Profile ownership | POSIX exclusive lock | named pipe | POSIX exclusive lock | `desktop-lifecycle` |
| File modes | `chmod` 0700/0600 | skipped | `chmod` | `trace-security`, `config-storage` |
| Process trees | detached group | job object, no detached group | detached group | `owned-process-tree`, `owned-process-windows` |
| Native canvas binding | `darwin-arm64` package | `win32-x64-msvc` package | host package | `native-binding` |
| Text encoding hints | none | UTF-8 reminder block | none | `prompt-builder` |
| Design-system outputs (wireframe SVG, starter stylesheet and skeleton) | byte-identical | byte-identical | byte-identical | `os-portability` (pinned digests) |
| Stage paths with spaces and non-ASCII characters | supported | supported | supported | `os-portability` |
| CRLF entrypoints | fresh-page and measured-page checks unaffected | unaffected | unaffected | `os-portability` |

## Known gaps

- Long paths on Windows (over 260 characters) are not exercised; stage paths stay short by design.
- File locking on Windows: a crop or asset overwrite can fail with EBUSY or EPERM while another process holds the
  file. Review crops are report-only, so a failed write leaves the target without crops instead of failing the turn.
- Case-insensitive file systems (macOS, Windows): two extracted hero images whose names differ only by case share one
  file on disk. Staging verifies size and digest, so the loser is skipped, never mixed.
- Fonts and DPI: measurements and reference screenshots come from the extracting machine's installed fonts at device
  scale factor 1; SSIM comparisons are only meaningful between renders made on the same machine.
