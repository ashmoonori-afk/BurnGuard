# BurnGuard security assessment and remediation

Date: 2026-09-13

Baseline: `271fdb9d0508ffa0f76862b4964da9b6c92eae97`

Scope: current browser, API, storage, import, renderer, native CLI, process, update, dependency, CI and release boundaries.

## Executive summary

This review combined four independent code audits, the existing 2026-09-09 baseline, dependency and secret scans, structural sink searches, focused hostile fixtures and real system-Chrome probes. Every product change below corresponds to a reproduced or directly traced boundary failure. Fixes stay at security boundaries rather than adding confirmation dialogs, disabling normal editing or changing ordinary project workflows.

The most important repairs isolate export/thumbnail browsers across pages and WebSockets, prevent Git and research-source SSRF, preflight compressed fonts before fontkit allocation, and keep provider diagnostics and project-scoped agent configuration out of trusted conversation/execution state.

## Trust model

Protected assets:

- Launch capability and capability cookie.
- Provider/API credentials and native CLI authentication.
- Project, attachment, design-system, export and update bytes.
- Local filesystem paths, diagnostics and conversation history.
- Loopback, LAN and cloud-metadata network surfaces.
- Browser, CLI, Python, Git and updater child-process ownership.

Relevant untrusted inputs:

- Imported archives, documents, fonts, repositories and websites.
- Generated or imported HTML, CSS, JavaScript and links.
- Provider stdout/stderr and structured events.
- Research-source URLs and documents.
- Browser requests originating from generated artifacts.
- Concurrent API calls and cancellation timing.

BurnGuard is a local single-user application, but generated/imported content and remote source endpoints are not trusted. Native model CLIs remain a privileged boundary: they intentionally receive project context and can invoke tools according to the selected CLI and permission mode.

## Repaired findings

| ID | Severity | Reproduced boundary failure | Repair and UX behavior |
|---|---|---|---|
| SEC-01 | High | Exported artifact JavaScript opened popup pages whose HTTP and `file:` requests bypassed the page-scoped render route. | Install the existing policy at `BrowserContext` scope, block service workers, record/close extra pages and retain all allowed staged-file/deck runtime behavior. |
| SEC-02 | High | Artifact WebSockets bypassed HTTP routing and reached an owned loopback listener without a finding. Thumbnails share the renderer. | Intercept WebSockets at context scope and close the client route without connecting upstream. Normal local assets and rendering remain available. |
| SEC-03 | High | Explicit `source_type: "github"` sent arbitrary HTTPS hosts to Git and followed an HTTPS-to-HTTP redirect to a private listener. | Require source type to match the supported forge inference, disable redirects, credential helpers, prompts and non-HTTPS protocols, isolate Git configuration/environment and return a bounded public error. Supported GitHub, GitLab and Bitbucket URLs remain. Arbitrary public websites continue through pinned website ingestion. |
| SEC-04 | High | A 74-byte WOFF declared a 1 GiB table and reached fontkit's attacker-sized allocation path. | Preflight WOFF/WOFF2 structure, table count, expanded bytes and stored ranges before fontkit. Valid bundled WOFF2 fonts retain the same upload flow and invalid fonts retain the existing error UX. |
| SEC-05 | Medium | Claude error results and Codex structured error items became assistant chat, SSE, SQLite history, traces and later prompt context, including synthetic secret/path sentinels. | Structured provider diagnostics no longer become chat/history. Bounded terminal status events remain visible. Unknown structured Codex events are not rendered as authored text. Server diagnostics retain only bounded error name/code metadata. |
| SEC-06 | Medium | `allow-popups` let opaque canvas artifacts bypass the intended network policy and choose popup destinations. | Remove native popup capability. Internal links continue through the existing parent navigation bridge; trusted external anchor clicks are reparsed by the parent and opened with `noopener,noreferrer`. Programmatic popups remain blocked. |
| SEC-07 | Medium | Active raw project/design-system documents could be framed from another loopback port because SameSite cookies are not port-scoped and the artifact CSP omitted `frame-ancestors`. | Raw active-content responses allow framing only from their exact application origin. Same-origin canvas/preview flows remain valid. |
| SEC-08 | Medium | Project-scoped `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `AGENTS.override.md`, `.mcp.json`, `.claude/` and `.codex/` content entered canonical or ancestor state and could affect later CLI turns. | Exclude agent control paths from canonical artifacts, file indexing and watcher signals; reject them during import. A second pre-provider check blocks generation in a legacy project that already contains one and gives localized rename guidance. Existing user bytes are preserved rather than deleted. Other project views and editing remain available. |
| SEC-09 | Medium | Concurrent session requests passed a separate global-capacity check, then all reserved distinct sessions beyond the configured ceiling. | Combine per-session and global admission synchronously before body parsing. Preserve 409 for a busy session, return 429 for global capacity and release reservations on every subsequent validation failure. |
| SEC-10 | Medium | Aborting acquisition killed only the Git/Python root while owned descendants survived. | Snapshot the owned tree before signalling, escalate TERM/KILL with bounded waits, verify cleanup and never target unrelated processes. |
| SEC-11 | Low | Research-source hostnames were text-validated but resolved later by `Bun.fetch`, leaving DNS rebinding to private addresses. | Reuse the public-address resolver, pin each connection address and preserve the original Host/TLS identity with redirects disabled. |
| SEC-12 | Low | The frontend authorization primitive attached the launch capability to absolute cross-origin URLs. | Reject cross-origin URLs before creating capability-bearing headers. Relative and same-origin absolute API requests work unchanged. |
| SEC-13 | Low | Private JSON/SSE responses did not consistently prevent storage or MIME sniffing. | Add `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` at the JSON/SSE API boundary without changing cache behavior for raw artifact/static resources. |
| SEC-14 | Low | Session traces were created as 0644 and provider/preparation diagnostics exposed internal details. | Force POSIX trace directories/files to 0700/0600, return stable public preparation errors and retain only bounded error name/code and stderr byte counts for provider failures. |
| SEC-15 | Low | Concurrent macOS apply requests verified and scheduled the same staged package multiple times. | Reserve one apply transition before any await, snapshot the staged package, return an idempotent applying state and release the reservation on verification/spawn failure. The restart/apply UX and 202 behavior remain. |

## Existing controls revalidated

- Exact loopback Host authority, strict mutation Origin checks and launch-scoped capability checks.
- HttpOnly/SameSite capability cookie for private GET/SSE plus in-memory frontend capability.
- Per-route request body limits, message limits and archive/acquisition budgets.
- Symlink/junction-aware path containment and canonical tree identity.
- Top-level raw active-content downloads, `nosniff`, artifact CSP and anti-framing application shell.
- Pinned website acquisition, redirect revalidation and public-address enforcement.
- Immutable private attachment capture and artifact publication identity.
- Owned CLI interruption and browser cleanup.
- Write-only settings summaries and atomic mode-0600 configuration.
- Update package size/SHA-256 verification and source-mode update disablement.

## Dependency and supply-chain status

`bun audit` still reports four allow-listed advisories:

- `image-size` through 2.0.2: [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq). The affected ICNS/JXL/HEIF parsers are not reached by BurnGuard's PPTX export path, and no patched npm release after 2.0.2 is currently available.
- React Router before 7.18.0: [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) and [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg). BurnGuard does not use SSR hydration and does not pass user-controlled destinations to router navigation. Migration to 7.18+ is a separate major-version change.

The security workflow documents explicit removal conditions and now includes the new deterministic boundary tests. The baseline HEAD's remote dependency audit and gitleaks steps passed. Current uncommitted changes were also scanned locally by credential-shape/path checks without printing candidate values.

## Residual risks and non-blocking follow-up

These items were not hidden or represented as fixed:

1. **Native CLI privilege boundary.** Claude/Codex authentication and tool operation intentionally require a privileged child process. Environment-based authentication can be visible to that process, and model/tool behavior remains subject to the selected CLI permission mode. Removing all inherited credentials or file visibility would break supported authentication/tool workflows; stronger brokered credentials and OS sandbox profiles need product design.
2. **Post-exit detached descendants.** Tree cleanup is reliable while the owned root remains observable. A process that deliberately detaches and is reparented before normal root exit cannot be proven owned by a later ancestry scan. A persistent OS job/supervisor is required.
3. **Installer/extractor lifecycle.** Browser/Python installers and some attachment extraction paths do not yet share one application-wide shutdown owner and complete wall deadline.
4. **Global expensive-work admission.** Exports, design audits and concurrent research runs have per-operation limits but no unified process-wide CPU/memory queue. This is primarily local availability hardening because API authority is required.
5. **Font CPU isolation.** Expanded allocation is bounded, but fontkit parsing still runs in the API process without a hard worker CPU deadline.
6. **Release authenticity.** Update SHA-256 protects integrity against corruption, not a compromised release publisher able to replace both feed and package. Code signing/notarization, immutable action pins, locked .NET restore, SBOM/provenance and a security-gated publish environment remain release-engineering work requiring signing/repository policy.
7. **Platform navigation.** External canvas links are parent-owned in browser/Windows flows. macOS lacks an existing `WKUIDelegate` external-window implementation, and Windows subframe navigation cancellation remains separate shell hardening.
8. **Browser protocol surface.** HTTP/file/popup/WebSocket/service-worker paths are tested. WebRTC/UDP isolation is not claimed by Playwright routing and should be addressed with a dedicated renderer process/network sandbox if artifacts later use WebRTC.

## Verification

Final local evidence:

- The first independent gate review rejected two boundary mismatches: nested `.claude`/`.codex` directories could enter publication, and resultless CLI failures could emit error-idle without an error notification. Both were reproduced before correction.
- Nested control directories are now normalized and excluded at every depth by canonical publication, managed-file indexing and watcher filtering. A real staged publication retained its ordinary sibling file, created no control-file blocker and preserved the existing-user-file policy.
- Actual Claude and Codex adapters were run through turn orchestration with a resultless nonzero executable. Each now produced exactly one bounded `status.error` and one error-idle without publishing child diagnostics.
- Gate-correction RED: **30 passed, 3 failed** across the publication and actual-adapter tests; watcher/index RED: **4 passed, 2 failed**. Focused GREEN: **39 passed, 0 failed**, 142 expectations across 3 files.
- Post-gate security regression set: **314 passed, 5 existing opt-in skips, 0 failed**, 1,294 expectations across 27 files.
- Final complete root run: **1,605 passed, 11 existing platform/opt-in skips, 2 external prerequisite failures**, 343,797 expectations across 208 files.
- The two enabled failures are unchanged QA harness cases requiring a hard-coded historical `omo-agent-toolkit` ULW session (`preflight` and `manifest-smoke`). They were not skipped, weakened or reported as passing.
- Root typecheck: exit 0.
- Frontend and Windows-target backend packaging: exit 0. The existing large-chunk and nonrelocatable local-Node warnings remain.
- Unfiltered dependency audit: exit 1 with the four documented advisories. The same audit with the reviewed four-ID allowlist: exit 0.
- `git diff --check`: exit 0.
- Isolated system-Chrome core browser regression: **10/10 passed**, including project opening, clipboard image/text, edit, comment, draw, undo/redo, canvas controls, responsive behavior and cleanup.
- Synthetic-CLI real HTTP/SSE verification: **86 passed, 0 failed**. Exactly one bounded error and one error-idle reached the user; synthetic secret/path sentinels were absent from SSE, SQLite events/history, trace files and the next prompt. Authorized JSON/SSE responses carried `no-store` and `nosniff`.
- Real system-Chrome security cases passed for popup HTTP/file isolation, zero-upstream WebSockets in export and thumbnail flows, blocked programmatic canvas popups, parent-owned external/internal links with user activation and ordinary staged rendering.
- Focused control-file UX regression: unsafe legacy control files returned a localized 409 before provider execution, created no event and retained exact user bytes.
- Failing-first evidence is retained under `/tmp/burnguard-*-red*.log`; final auth and independent audit reports are under `/tmp/burnguard-security-*.md`.

No public deployment, native update, credential change or merge was performed. Commit and PR delivery record only these reviewed source, test, workflow and report changes.
