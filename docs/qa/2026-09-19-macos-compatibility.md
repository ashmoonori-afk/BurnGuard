# macOS compatibility audit — 2026-09-19

Base: `5ef6016b5367937407a7e2446466749d6fab92e2` (`origin/main` after fetch).
Host: Apple Silicon macOS, Bun 1.3.14. Work ran in an isolated worktree.

## Confirmed defects and changes

| Surface | Reproduction | Change |
|---|---|---|
| Native canvas | WKWebView cancelled `about:srcdoc`; the sandboxed frame did not execute | Allow srcdoc subframes only; retain top-level origin restrictions |
| Native exports | WKWebView cancelled the application's blob download | Use WKDownload and NSSavePanel for downloads initiated by the trusted main frame; reject foreign blob origins and redirects |
| Codex readiness | The authentication probe timed out while its descendant remained alive | Reuse owned process-tree cleanup and drain streams before settling |
| Python PDF dependencies | Homebrew Python rejected `pip install --user` under PEP 668 | Install pinned pypdf in an app-owned venv; share interpreter selection with extraction |
| Standalone logo SVG | An accepted SVG without the root namespace failed image decoding | Require the SVG namespace, preserving existing validation precedence |
| macOS packaging | Homebrew Node was silently omitted, leaving PDF/runtime operations dependent on ambient PATH | Fail before replacing resources unless required Node is relocatable |
| QA harness | Tests depended on an old toolkit session and checkout identity | Use isolated prerequisite/repository fixtures while retaining production authority checks; report missing toolkit explicitly |
| Cancellation regression test | Handler entry was mistaken for active body streaming; GC before headers reproduced a 15-second timeout | Observe the native client's first body chunk before cancellation; retain forced GC and existing abort/cleanup assertions |

## Captured verification

- Baseline root suite: **2008 passed, 12 skipped, 4 failed**.
- Installing matched Chromium resolved the two browser failures, but **not** the two QA harness failures. The latter depended on missing toolkit/session prerequisites. Earlier attribution of all four failures to Chromium was incorrect.
- Authentication regression: observed surviving descendant before the fix; **9 readiness tests passed** after it.
- Logo suites: **178 passed** after namespace validation and valid-fixture updates. Real Chrome decoded the namespaced SVG and rejected the namespace-less image.
- Python lane: **58 focused tests passed**. Actual Homebrew Python installed pypdf 6.18.0 into a disposable profile containing spaces and Korean characters, extracted a PDF, and returned healthy status.
- Packaging lane: **10 focused tests passed**. Missing/nonrelocatable Node was rejected before touching staged resources. Official Node 22.23.2 was copied byte-for-byte and executed with empty PATH.
- QA harness: **20 focused tests passed**, including missing prerequisites and incorrect repository authority. A real-checkout acceptance run still requires its toolkit/session; `ulw_toolkit_missing` is not a passing acceptance result.
- Complete `bun run build:mac`: **exit 0**, with official standalone Node on PATH and process-local `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
- Packaged native smoke: **exit 0**; visible native window, sandboxed canvas reply from an opaque origin, completed download with exact bytes, screenshot captured, no external browser launched, backend exited before profile cleanup.
- Native boundary probes retained denial of foreign HTTP navigation, top-level srcdoc and top-level blob navigation. NSSavePanel presentation was observed.
- Packaged live HTTP: health **200**, bootstrap **200**, authenticated local-font listing **200** with **248 families**, unauthenticated font request **403**. The packaged server ran with system-only PATH.
- Real Chrome desktop (1280 × 800) and mobile (390 × 844) home screenshots were inspected; no blank or overlapping initial layout was observed.

## Build environment

The first native build exited 69 because the selected full Xcode installation required license acceptance. Command Line Tools Swift was available. A process-local developer-directory override enabled compilation; no global Xcode setting or license was changed.

## Coverage limits

- This audit exercised macOS arm64, not Intel macOS or Windows.
- Native download completion used the explicit smoke destination; save-panel visibility was tested, but its interactive Save button was not automated.
- No paid/authenticated AI generation or real provider image-generation trace was executed.
- No release signing/notarization, installer upgrade or distribution publication was performed.
- Platform-only and explicitly opt-in cases remain visible as skips; they are not counted as passes.

## Final integration

The first integrated full run passed typecheck and recorded **2028 passed, 12 skipped, 1 failed**. The failure was the recurring streamed-request cancellation timeout, not a missing-browser failure.

The original cancellation test passed without forced GC but timed out with GC after server handler entry. That barrier did not establish that response headers or body bytes had reached the client. The test now observes actual native reader bytes before cancellation and retains forced GC. It does not fabricate network responses, increase timeouts, retry, or weaken abort/cleanup assertions. A 130-file integration run passed **1108 tests, 8 skipped, 0 failures** after this change. This fixes the test's streaming precondition; it does not claim to patch Bun's pre-header cancellation behavior.

Final verification after that fix:

- `bun run typecheck`: **exit 0**.
- `bun test`: **2029 passed, 12 skipped, 0 failed**, 2041 tests across 256 files, one run in 107.49 seconds.
- The last change was test-only; the native package and live API/browser evidence above cover the unchanged production tree.
