# ADAPTERS KNOWLEDGE BASE

## OVERVIEW

Claude Code and Codex subprocess/stream translation boundary; earned this guide at score 8 for module entrypoints, distinct provider protocols, and shared adapter exports.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Dispatch backend | `registry.ts` | Exhaustive switch over shared `BackendId` |
| Shared lifecycle types | `types.ts` | Input, result, decision, and callback contracts |
| Claude command/run | `claude-code/runner.ts`, `claude-code/index.ts` | JSON stream process ownership |
| Claude stream parsing | `claude-code/parser.ts` | Assistant/tool/file/usage normalization |
| Codex command/run | `codex/index.ts` | Argv build and `Bun.spawn` live here; there is no `codex/runner.ts` |
| Codex stream parsing | `codex/parser.ts` | `parseCodexLine` falls through to raw text on non-JSON |
| Codex event mapping | `codex/event-mapping.ts` | `mapCodexEnvelope` turns provider events into shared events |
| Child cleanup | `owned-process-tree.ts`, `process-streams.ts` | Spawn options, tree kill, and stream settle before completion |

## CONVENTIONS

- Normalize provider output into `@bg/shared` events; provider-specific shapes do not escape this directory.
- Parse stdout line-by-line and isolate malformed lines so one bad event cannot wedge the child pipe.
- Route lifecycle cancellation through the owned child process and observe all late promise rejections.
- Release decision subscriptions in cleanup regardless of success, interruption, or parser failure.
- Redact command/environment/provider diagnostics before returning adapter results to higher layers.
- Keep backend selection exhaustive; adding a `BackendId` requires registry handling and parser/runner tests.
- Build provider argv as arrays, never concatenated shell strings.
- Vanilla Codex runs (`--ignore-user-config`) must re-add `windows.sandbox="unelevated"` on Win32; otherwise `exec` degrades to read-only.

## ANTI-PATTERNS

- Do not use `codex -p` as print mode; `-p` is a profile flag, while noninteractive execution uses `codex exec`.
- Do not let malformed JSON terminate stream consumption or leave pipes unread.
- Do not assume current one-shot CLIs support a live tool-decision round trip; events are presently observational.
- Do not expose API keys, tokens, full environment dumps, or private paths in events or logs.
- Do not mark a turn complete before process exit, stream drain, and owned cleanup settle.
- Do not turn surviving cleanup stragglers into silent success; retain diagnostics without leaking them to users.
- Do not duplicate prompt policy here; adapters transport the harness prompt unchanged.
