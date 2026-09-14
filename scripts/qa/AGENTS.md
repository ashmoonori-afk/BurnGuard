# QA HARNESS KNOWLEDGE BASE

## OVERVIEW

Evidence-producing acceptance harness (65 runners, helpers, and fixtures, ~13k LOC) spanning Bun CLIs, Node/Playwright browser fixtures, and POSIX HTTP scenarios; earned this guide at score 11 for file count, its own TypeScript project, and a contract distinct from the build scripts above it.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Gate prerequisites | `preflight.ts` | Repo identity, tools, auth, browser, free port; `--json` receipt |
| Browser suite entry | `e2e-smoke.mjs` | Composes six `*-fixtures.mjs` runners plus `runClipboardPasteFixture`; `--only core` skips the ui-redesign pass |
| Browser fixtures | `review-ui`, `review-canvas`, `ui-redesign`, `creation-canvas`, `settings-redesign`, `deliverables` `-fixtures.mjs`, `clipboard-paste-fixtures.mjs` | Node 22 + Playwright ESM, outside the TS project |
| Full feature suites | `full-feature-runner.mjs`, `full-*.mjs` | 16 capability suites (settings-attachments 718 LOC is the largest); the runner owns the isolated browser process and profile |
| Shared fixture helper | `creation-canvas-fixtures.mjs` `createFixture` | Imported by deliverables, element-attributes, and workspace suites |
| Process/port ownership | `runtime.ts`, `port.ts`, `cleanup.ts`, `cleanup-coordinator.ts` | `OwnedResources`, `parseQaPort`, `isPortOwnedBy`, bounded readiness |
| Isolated profiles | `evidence.ts` | `createIsolatedHome`/`removeIsolatedHome`, `currentAttemptDirectory` |
| Evidence schema | `manifest.ts`, `manifest-publication.ts`, `sanitization.ts` | Strict parsers, atomic publish, path digests/redaction |
| Repo pinning | `repository.ts` | Asserts branch `main`, configured origin, expected base commit |
| HTTP scenarios | `task-4..task-8*.sh` | Extraction, catalog, learning, artifact recovery, export/faults/gates |
| Packaging smokes | `package-smoke.mjs`, `windows-native-smoke.mjs`, `native-mac-smoke.ts` | Portable, Windows shell, macOS app |
| Typed failures | `errors.ts` | `QaInputError`, `QaPreflightError`, `QaTimeoutError` |

## CONVENTIONS

- `tsconfig.json` here is a composite `noEmit` project (`include: ["*.ts"]`, Bun types, `@bg/shared` path, reference to `packages/shared`) - `.mjs` fixtures are deliberately outside it.
- TypeScript runners use Bun APIs (`Bun.spawn`, `bun:sqlite`); browser fixtures use Node/Playwright; shell scenarios assume `bun`, `curl`, `jq`, `sqlite`.
- Every run owns an isolated `QA_HOME`/attempt directory and asserts ownership before deleting anything.
- Receipts are machine-oriented: fixed schema/version fields, SHA-256 digests, sanitized `<repo>`/`<qa-home>`/`<home>` placeholders, atomic manifest publication.
- Fixture mode replaces `fetchSource`, `runWorker`, and `synthesize` with functions that throw, so a crossed boundary fails loudly instead of hitting a provider.
- Async waits subscribe to a signal or a bounded deadline; `task-8-sse-wait.ts` exists so scripts never poll blindly.

## ANTI-PATTERNS

- Do not add `as any`, `@ts-ignore`, `@ts-expect-error`, debug logging, fixed `sleep`, or `waitForTimeout` - the task-8 static gate rejects them.
- Do not emit provider output, environment values, or absolute private paths into receipts; CLI failures carry typed codes only.
- Do not loosen the repository identity assertions to make a local run pass.
- Do not mutate fixtures, evidence, or profiles through unowned paths, and do not silently repair a corrupt receipt.
- Do not assume Chromium, `jq`, or provider auth is present before `preflight.ts` says so.

## COMMANDS

```bash
bunx tsc -p scripts/qa/tsconfig.json --noEmit
bun scripts/qa/preflight.ts --json
node scripts/qa/e2e-smoke.mjs [--only <fixture>]
bash scripts/qa/task-8-gates.sh
```
