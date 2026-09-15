import { ulid } from "ulid";
import type { NormalizedEvent } from "@bg/shared";
import type { AdapterRunInput, AdapterRunResult } from "./types";
import { ownedProcessSpawnOptions } from "./owned-process-tree";
import { settleProcessStreams } from "./process-streams";

export interface CliTurnOptions {
  /** Provider label used only in local diagnostics; never reaches an event or the UI. */
  readonly provider: string;
  readonly cmd: readonly string[];
  /** Prompt bytes to pipe on stdin, or null when the prompt travels in argv. */
  readonly stdinPrompt: string | null;
  readonly parse: (line: string) => NormalizedEvent[];
}

/**
 * Runs one non-interactive CLI turn and normalizes its stdout.
 *
 * Shared by the Gemini, Copilot and Grok adapters, which differ only in argv and line shape. The
 * Claude Code and Codex adapters keep their own runners: their process handling predates this and
 * rewriting them would risk two shipped providers for no behaviour gain.
 */
export async function runCliTurn(
  input: AdapterRunInput,
  options: CliTurnOptions,
): Promise<AdapterRunResult> {
  let sawIdle = false;

  // Decisions cannot round-trip into a one-shot CLI; the sink exists so the subscription is owned
  // and released exactly like the other adapters.
  const unsubscribeDecision = input.onDecision?.(() => {});

  const proc = Bun.spawn({
    cmd: [...options.cmd],
    cwd: input.projectDir,
    stdin: options.stdinPrompt === null ? "ignore" : new Blob([options.stdinPrompt]),
    stdout: "pipe",
    stderr: "pipe",
    ...ownedProcessSpawnOptions(),
  });

  let exitCode: number;
  try {
    const readers = [
      readLines(proc.stdout, async (line) => {
        let events: NormalizedEvent[];
        try {
          events = options.parse(line);
        } catch (error) {
          // A single bad line must never abort the read loop and clog the child's stdout pipe.
          // eslint-disable-next-line no-console
          console.warn(`[${options.provider}] parser threw on a stream line — skipping:`, error);
          return;
        }
        for (const event of events) {
          if (event.type === "status.idle") sawIdle = true;
          await input.onEvent(event);
        }
      }),
      readLines(proc.stderr, async (line) => {
        await input.onStderr?.(line);
      }),
    ];
    exitCode = await settleProcessStreams(proc, readers, input.signal);
  } finally {
    unsubscribeDecision?.();
  }

  if (!sawIdle) {
    await input.onEvent({
      id: ulid(),
      ts: Date.now(),
      type: "status.idle",
      stopReason: input.signal?.aborted ? "interrupted" : exitCode === 0 ? "end_turn" : "error",
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
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.length > 0) await onLine(line);
        index = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) await onLine(buffer);
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
