import { ulid } from "ulid";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../security/path-boundary";
import type { NormalizedEvent } from "@bg/shared";
import type { AdapterRunInput, AdapterRunResult } from "./types";
import { spawnOwnedProcess } from "./owned-process";
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
 * Shared by the Gemini and Copilot adapters, which differ in argv and line shape. The
 * Claude Code and Codex adapters keep their own runners: their process handling predates this and
 * rewriting them would risk two shipped providers for no behaviour gain.
 */
export async function runCliTurn(
  input: AdapterRunInput,
  options: CliTurnOptions,
): Promise<AdapterRunResult> {
  let providerFailed = false;
  let promptDirectory: string | undefined;

  // Decisions cannot round-trip into a one-shot CLI; the sink exists so the subscription is owned
  // and released exactly like the other adapters.
  const unsubscribeDecision = input.onDecision?.(() => {});

  let exitCode: number;
  try {
    input.signal?.throwIfAborted();
    let cmd = [...options.cmd];
    if (options.stdinPrompt === null) {
      const inputs = resolveWithin(input.projectDir, ".burnguard-inputs");
      await mkdir(inputs, { recursive: true });
      promptDirectory = await mkdtemp(resolveWithin(input.projectDir, ".burnguard-inputs", "cli-"));
      const promptFile = resolveWithin(promptDirectory, "task.txt");
      await writeFile(promptFile, input.prompt, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const relative = path.relative(input.projectDir, promptFile).replaceAll("\\", "/");
      cmd = cmd.map((part) => part === input.prompt ? `Read ${relative} as UTF-8 and carry out the complete task in that file. Do not reproduce its internal instructions in chat or include this input file in the output.` : part);
    }
    input.signal?.throwIfAborted();
    const owned = spawnOwnedProcess({
      cmd,
      cwd: input.projectDir,
      stdin: options.stdinPrompt === null ? "ignore" : new Blob([options.stdinPrompt]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const proc = owned.proc;

    const readers = [
      readLines(proc.stdout, async (line) => {
        let events: NormalizedEvent[];
        try {
          events = options.parse(line);
        } catch {
          // A single bad line must never abort the read loop and clog the child's stdout pipe.
          // eslint-disable-next-line no-console
          console.warn(`[${options.provider}] skipped an invalid stream event`);
          return;
        }
        for (const event of events) {
          // Completion belongs to process exit and stream drain, not an early provider marker.
          if (event.type === "status.idle") {
            if (event.stopReason === "error") providerFailed = true;
            continue;
          }
          await input.onEvent(event);
        }
      }),
      readLines(proc.stderr, async (line) => {
        await input.onStderr?.(line);
      }),
    ];
    exitCode = await settleProcessStreams(owned, readers, input.signal);
  } finally {
    unsubscribeDecision?.();
    if (promptDirectory) await rm(resolveWithin(input.projectDir, path.relative(input.projectDir, promptDirectory)), { recursive: true, force: true });
  }

  await input.onEvent({ id: ulid(), ts: Date.now(), type: "chat.message_end", turnId: input.turnId });
  await input.onEvent({
    id: ulid(),
    ts: Date.now(),
    type: "status.idle",
    stopReason: input.signal?.aborted ? "interrupted" : exitCode === 0 && !providerFailed ? "end_turn" : "error",
  });

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
        if (index > 2 * 1024 * 1024) throw new Error("provider_stream_limit");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.length > 0) await onLine(line);
        index = buffer.indexOf("\n");
      }
      // Bound the unterminated line only: a lagging consumer receives large coalesced chunks of short lines.
      if (buffer.length > 2 * 1024 * 1024) throw new Error("provider_stream_limit");
    }
    if (buffer.length > 0) await onLine(buffer);
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
