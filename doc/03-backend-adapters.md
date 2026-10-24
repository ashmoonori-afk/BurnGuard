# LLM Harness and Backend Adapters

This document describes the **current** adapter implementation, reviewed for v0.5.33 on 2026-10-18.

## 1. Current Design Principles

The adapter registry (`adapters/registry.ts`) dispatches `claude-code`, `codex`, `gemini`, and `copilot`.

1. Normalize backend output into one `NormalizedEvent` stream
2. Persist every meaningful event so session history survives refresh and reload
3. Build prompt context on every turn from project state and design system data
4. Keep the initial implementation simple and local-first, even if it is less ambitious than the original plan
5. Prefer explicit "not implemented yet" behavior over pretending advanced harness features exist

## 2. Actual Turn Orchestration

The current turn entrypoint is `packages/backend/src/services/turns.ts`.

For each user turn, the backend currently:

1. Loads session and project context
2. Persists the raw `user.message`
3. Emits a normalized `chat.user_message`
4. Emits `status.running`
5. Builds a prompt with project files, design system excerpts, and attachments
6. Runs the selected adapter
7. Persists and fanouts normalized events through the broker
8. Re-indexes project files
9. Marks the session idle and writes a checkpoint

Important current behavior:
- turn admission is enforced per session and across the process: the session event route returns `409 session_busy` when that session already has a running turn, and `429 turn_capacity_exhausted` when active sessions reach `harness.maxConcurrentSessions`
- execution is per-turn subprocess invocation, not a long-lived interactive shell session

## 3. Current Normalized Event Schema

The source of truth is `packages/shared/src/events.ts`.

Notable currently used event types:

```ts
type NormalizedEvent =
  | { type: "chat.user_message"; id: string; ts: number; turnId: string; text: string; attachmentCount: number }
  | { type: "chat.delta"; id: string; ts: number; turnId: string; text: string }
  | { type: "chat.thinking"; id: string; ts: number; turnId: string; text: string }
  | { type: "chat.message_end"; id: string; ts: number; turnId: string }
  | { type: "tool.started"; id: string; ts: number; turnId: string; toolCallId: string; tool: string; input: unknown }
  | { type: "tool.finished"; id: string; ts: number; turnId: string; toolCallId: string; tool: string; ok: boolean; output?: unknown }
  | { type: "file.changed"; id: string; ts: number; turnId: string; action: "created" | "edited" | "deleted"; path: string }
  | { type: "status.running"; id: string; ts: number }
  | { type: "status.idle"; id: string; ts: number; stopReason: "end_turn" | "requires_action" | "interrupted" | "error" }
  | { type: "status.error"; id: string; ts: number; message: string; recoverable: boolean }
  | { type: "usage.delta"; id: string; ts: number; input: number; output: number; cached?: number };
```

Current practical meaning:
- `chat.user_message` is persisted so replay shows both sides of the conversation
- `file.changed` is emitted by adapter parsing, not by the file watcher
- `status.idle` is the unlock signal for the composer

## 4. Prompt Builder

The prompt builder lives at `packages/backend/src/harness/prompt-builder.ts`.

Current prompt contents:
- project metadata
- current indexed file list
- design system metadata
- optional excerpts from `SKILL.md`, `colors_and_type.css`, and `README.md`
- attachment paths
- explicit delivery rules
- the current user request

This is simpler than the original long-term plan:
- no tweak diff injection yet
- no conversation summarization
- no tool permission contract injection

## 5. Claude Code Adapter

### 5.1 Execution model

The Claude Code runner uses `Bun.spawn` and pipes the prompt to stdin.

Current command shape:

```text
claude -p --output-format stream-json --verbose
```

Behavior notes:
- subprocess cwd is set to the project directory
- stdout is consumed line by line
- stderr is also streamed into trace logging
- if Claude exits without an explicit final idle/result event, the adapter emits a synthetic `status.idle`

### 5.2 Parser behavior

The parser lives at `packages/backend/src/adapters/claude-code/parser.ts`.

Currently mapped:

| Claude stream-json object | Normalized event(s) |
|---|---|
| `system` | ignored, because `status.running` is emitted by the orchestrator |
| assistant text block | `chat.delta` |
| assistant thinking block | `chat.thinking` |
| assistant tool_use block | `tool.started` |
| user tool_result block | `tool.finished` |
| successful write/edit tool_result | `file.changed` if the path resolves inside the project |
| result with usage | `usage.delta` + `chat.message_end` + `status.idle` |

Additional flags passed today: `--permission-mode acceptEdits`, `--effort <level>` (defaults to `low`), `--model` when chosen, `--safe-mode` in vanilla mode, `--include-partial-messages` when supported by the installed CLI, and `--mcp-config`/`--allowedTools` for the web-asset server under the `claude-frontier` profile.

Current limitations:
- no tool permission gate before execution
- no resume-by-session-id integration

Turn interruption is supported: the session interrupt route signals abort to the turn and terminates the owned process tree.

While a turn is running, the session row stores the provider process ownership record (the POSIX PID with its birth identity, or the Windows named Job token). After an unexpected backend exit, startup stops any recorded provider process before restoring project files, and aborts startup if it cannot confirm that the process has stopped (`adapters/owned-process-record.ts`, `services/session-process-recovery.ts`).

## 6. Codex Adapter

### 6.1 Execution model

Current command shape (along with `-c` options for reasoning effort, reasoning summary, image generation toggle, optional progress metrics, `--model`, and vanilla-mode flags):

```text
codex exec --json --skip-git-repo-check --sandbox workspace-write -
```

Behavior:
- prompt text is piped through stdin so it is not exposed in process listings
- stdout JSONL is normalized into chat, tool, file-change, usage, and completion events
- stderr is consumed in parallel and traced
- completed file-change paths are normalized against the project boundary
- the adapter emits one `chat.message_end` and terminal `status.idle` sequence

### 6.2 Limitations

The current Codex path does **not** provide a replayable backend session identity. Turn cancellation terminates the owned process tree in the same way as Claude Code.

It remains a per-turn subprocess backend with shared session persistence around it.

## 7. Broker and Persistence

Current event fanout path:

1. adapter or orchestrator creates a `NormalizedEvent`
2. backend persists it through `db/events.ts`
3. backend appends trace information
4. broker publishes it to SSE subscribers
5. frontend dedupes by `event.id`

Current replay path:
- `GET /api/sessions/:id/events` rehydrates stored events from SQLite
- legacy `direction=up` rows can be synthesized into `chat.user_message` for older sessions

## 8. File Change Model

There are two separate mechanisms today:

### 8.1 Adapter-emitted file changes

The Claude Code and Codex parsers emit `file.changed` when:
- a recognized write/edit-style tool succeeds
- the target file path can be normalized relative to the project directory

This is what currently drives live canvas refresh and file tab opening.

### 8.2 Watcher-driven indexing

`services/watchers.ts` uses `node:fs.watch` to:
- watch project directories recursively
- debounce file system activity
- re-index the `files` table

It currently does **not** emit `file.changed` events into the chat stream.

## 9. Current Gaps Versus Original Plan

The earlier architecture docs described a larger harness than what exists. The following are still planned or partial, not shipped:

- PTY-based execution
- tool permission gating prior to execution
- retry/backoff strategy
- plugin adapter loading

## 10. What Is Stable Enough To Rely On

The following contracts are stable enough to document as current behavior:

- `NormalizedEvent` as stored in SQLite and streamed over SSE
- `chat.user_message` persistence for replay
- one turn at a time per session
- Claude Code `stream-json` parsing path
- project prompt building from indexed files and design system excerpts
- every export format defined in `@bg/shared/export` (`html_zip`, `pdf`, `png`, `pptx`, `handoff`, `png_zip`, `cafe24_package`, `imweb_package`, `svg`)
