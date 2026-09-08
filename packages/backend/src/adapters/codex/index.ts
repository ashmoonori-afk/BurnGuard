import { ulid } from "ulid";
import type { AdapterRunInput, AdapterRunResult } from "../types";
import { parseCodexLine, type CodexParserContext } from "./parser";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../owned-process-tree";
import { settleProcessStreams } from "../process-streams";

export function buildCodexCommand(binaryPath: string): string[] {
  return [
    binaryPath,
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "-",
  ];
}

/**
 * Codex adapter — streams stdout through `parseCodexLine`.
 *
 * Forward-compatible: when Codex ships a structured JSON stream the
 * parser maps those lines to `NormalizedEvent`s (tool.started /
 * tool.finished / file.changed / usage.delta / status.idle etc.).
 * Any line that isn't structured — including the entire current CLI
 * output — falls through to `chat.delta` so the Phase 1 raw-mode
 * behaviour is preserved byte-for-byte.
 */
export async function runCodexTurn(
  input: AdapterRunInput,
): Promise<AdapterRunResult> {
  const ctx: CodexParserContext = {
    turnId: input.turnId,
    projectDir: input.projectDir,
    toolNames: new Map(),
  };

  let sawIdle = false;
  let sawMessageEnd = false;

  // Same story as claude-code: register the sink for future mode
  // upgrades where decisions can be piped into the running CLI.
  const unsubscribeDecision = input.onDecision?.((decision) => {
    // eslint-disable-next-line no-console
    console.log(
      `[codex] tool decision received for ${decision.toolCallId}: ${decision.decision}` +
        (decision.reason ? ` (${decision.reason})` : ""),
    );
  });

  const proc = Bun.spawn({
    cmd: buildCodexCommand(input.binaryPath),
    cwd: input.projectDir,
    stdin: new Blob([input.prompt]),
    stdout: "pipe",
    stderr: "pipe",
    signal: input.signal,
    killSignal: "SIGKILL",
    ...ownedProcessSpawnOptions(),
  });

  // Same reason as the Claude Code adapter: `signal` kills the spawned root
  // only, which on Windows is the `codex.cmd` wrapper. Close the owned tree
  // as soon as the abort fires so the CLI cannot outlive the interrupt.
  const onAbort = () => { void closeOwnedProcessTree(proc.pid).catch(() => {}); };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  let exitCode: number;
  try {
    const readers = [
      readLines(proc.stdout, async (line) => {
        // Parser exceptions used to bubble up through readLines and
        // abort the read loop entirely, leaving the CLI subprocess
        // with a clogged stdout pipe and no clean exit. Trap here so
        // a single malformed line never wedges the whole turn.
        let events;
        try {
          events = parseCodexLine(line, ctx);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            "[codex] parser threw on a stream line — skipping:",
            err,
          );
          return;
        }
        for (const event of events) {
          if (event.type === "status.idle") sawIdle = true;
          if (event.type === "chat.message_end") sawMessageEnd = true;
          await input.onEvent(event);
        }
      }),
      readLines(proc.stderr, async (line) => {
        await input.onStderr?.(line);
      }),
    ];
    exitCode = await settleProcessStreams(proc, readers);
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    // Always release the decision sink — see the matching comment in
    // the Claude Code adapter. A throw between subscribe and here
    // would otherwise leak the listener into the broker.
    unsubscribeDecision?.();
  }

  if (!sawMessageEnd) {
    await input.onEvent({
      id: ulid(),
      ts: Date.now(),
      type: "chat.message_end",
      turnId: input.turnId,
    });
  }

  if (!sawIdle) {
    // The CLI exited without emitting a structured `done` line — emit
    // a synthetic status.idle so the UI unlocks the composer. Mirrors
    // the Claude Code adapter's "no result row → synthesize" behaviour.
    await input.onEvent({
      id: ulid(),
      ts: Date.now(),
      type: "status.idle",
      stopReason: input.signal?.aborted
        ? "interrupted"
        : exitCode === 0
          ? "end_turn"
          : "error",
    });
  }

  return { exitCode };
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) {
          await onLine(line);
        }
        idx = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) {
      await onLine(buffer);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}
