# BACKEND TESTS KNOWLEDGE BASE

## OVERVIEW

229 flat Bun suites plus 6 `*-cases.ts` modules and `learning-fixture.ts` (~34.3k LOC) covering backend `src/` end to end; earned this guide at score 8 as a distinct domain with its own isolation, platform-skip, and smoke-gate rules.

## STRUCTURE

```text
tests/
├── *.test.ts                       # one flat suite per behavior area
├── *-cases.ts                      # side-effect suites imported by a parent test
├── learning-fixture.ts             # shared schema fixture
├── fixtures/                       # worker/probe scripts, forged PDF receipt
└── helpers/platform.ts             # canCreateSymlink(), SYMLINK_SKIP_REASON
```

## WHERE TO LOOK

| Task | Suites | Notes |
|------|--------|-------|
| Touch path/serving boundaries | `serve-path-boundary`, `path-boundary`, `extraction-boundaries`, `visual-source-security` | Run together; they share the containment contract |
| Touch artifact authority | `artifact-operations`, `review-artifact-*`, `session-recovery`, `catalog` | Revision/digest/canonical-tree invariants |
| Touch export pipeline | `export-validation`, `export-recovery`, `exports`, `export-pdf`, `export-pptx` | `export-validation` side-effect imports `export-pdf-deadline-cases.ts` |
| Touch prompts/skills | `prompt-builder`, `reference-layout-prompt`, `visual-craft-skill`, `design-brief-prompt` | Assert machine tags and ordering, never prose |
| Touch provider adapters | `claude-code-parser`, `codex-parser`, `owned-process-tree`, `chromium-process-tree` | Real child processes; POSIX-only cases are skipped |
| Touch migrations/repos | `graphic-migration`, `research-migration`, `checkpoints`, `pipeline-repositories` | In-memory SQLite via `runMigrationsFrom` |

## CONVENTIONS

- Run from the repository root only: `bunfig.toml` preloads `scripts/test-preload.ts`, which mints a throwaway `BG_APP_ROOT`, migrates it, and removes it at exit. Root `bun test` timeout is 30s and coverage threshold is 0.8.
- Name tests as Given/When/Then prose; assert exact status codes, error `code` strings, digests, and DB rows rather than snapshots.
- Prefer real seams over mocks; the deliberate exception is `attachment-intake.test.ts`, which mocks `attachment-extraction` because the real path shells out to Python.
- Gate expensive surfaces behind env flags: `BG_UPLOAD_SMOKE=1` (Python/PPTX extraction), `BG_BROWSER_SMOKE=1` (real Chromium launch), `BG_EXPORT_SMOKE=1` (PDF/PNG/PPTX render). Default runs must pass with none of them set.
- Skip platform-impossible cases explicitly: `test.skipIf(!canCreateSymlink())` with `SYMLINK_SKIP_REASON`, and named skips for POSIX-only process and macOS-only QA CLI cases. A skip always states its reason.
- Create unique fixture IDs (`process.pid`, `crypto.randomUUID`) and clean rows, temp roots, watchers, and browsers in `afterEach`/`afterAll`; several Windows I/O suites raise their own timeout to 30-60s.
- Inject fault and timing knobs instead of patching internals: `BG_CATALOG_FAULT`, `BG_ARTIFACT_QA`, `BG_CHROMIUM_LAUNCH_TIMEOUT_MS`, `BG_CHROMIUM_ASSUME_USABLE`, `BG_THUMBNAIL_*`.

## ANTI-PATTERNS

- Do not add fixed sleeps or `waitForTimeout` as async synchronization; subscribe to the exact event or state change and await it under a bounded deadline. The remaining `Bun.sleep` calls in `chromium-capability.test.ts` and the thumbnail cooldown timer are legacy or time-under-test, not a pattern to copy.
- Do not pin prompt or UI prose; test sentinel tags, parsed fields, and shipped-copy equality only.
- Do not run backend tests against a real `~/.burnguard` profile or share a profile between processes; the preload owns profile creation and refuses to delete an unowned directory.
- Do not leave child processes, Chromium instances, watchers, or SQLite handles alive past a suite; process-tree suites can strand OS resources.
- Do not weaken a boundary suite to make a change pass; path, attachment, publication, and receipt suites encode security contracts.
