import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ulid } from "ulid";
import type { AdapterRunInput, AdapterRunResult } from "../types";
import { mapGeneratedImages } from "./event-mapping";
import { parseCodexLine, type CodexParserContext } from "./parser";
import { ownedProcessSpawnOptions } from "../owned-process-tree";
import { settleProcessStreams } from "../process-streams";

export function buildCodexCommand(binaryPath: string, generation?: AdapterRunInput["generation"], platform = process.platform): string[] {
  return [
    binaryPath,
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "-c", `model_reasoning_effort="${generation?.effort ?? "low"}"`,
    "-c", "suppress_unstable_features_warning=true",
    "-c", "features.image_generation=true",
    ...(generation?.model ? ["--model", generation.model] : []),
    ...(generation?.vanilla ? ["--ignore-user-config", "-c", "features.plugins=false", "-c", "features.skip_host_skill_discovery=true", "-c", "project_doc_max_bytes=0"] : []),
    // Ignoring user config also drops Windows sandbox selection and makes exec read-only.
    ...(generation?.vanilla && platform === "win32" ? ["-c", 'windows.sandbox="unelevated"'] : []),
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
    codexHome: process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
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
    cmd: buildCodexCommand(input.binaryPath, input.generation),
    cwd: input.projectDir,
    stdin: new Blob([input.prompt]),
    stdout: "pipe",
    stderr: "pipe",
    ...ownedProcessSpawnOptions(),
  });

  // The built-in image tool is silent on the stream for the whole generation (35-60 s each), so a
  // run that draws several images in a row looks stalled to the turn's idle detector. Watching the
  // thread's generated_images directory surfaces each image as an `image_generation` call the
  // moment it lands; the same events carry the provenance hashes the logo gate needs.
  let imageWatcher: FSWatcher | undefined;
  let imageEmits: Promise<void> = Promise.resolve();
  const emitGeneratedImages = () => {
    imageEmits = imageEmits.then(async () => {
      for (const event of mapGeneratedImages(ctx)) await input.onEvent(event);
    }).catch(() => undefined);
    return imageEmits;
  };
  const watchGeneratedImages = () => {
    if (imageWatcher !== undefined || ctx.codexHome === undefined || ctx.threadId === undefined) return;
    const threadId = ctx.threadId;
    try {
      imageWatcher = watch(path.join(ctx.codexHome, "generated_images"), { recursive: true }, (_type, name) => {
        if (typeof name === "string" && name.includes(threadId)) void emitGeneratedImages();
      });
      imageWatcher.on("error", () => undefined);
      // Anything that landed between thread.started and the watch attaching.
      void emitGeneratedImages();
    } catch {
      // No generated_images directory yet: the turn-end sweep in mapTurnCompleted still runs.
    }
  };

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
        watchGeneratedImages();
        // Keep watcher-driven image calls ordered ahead of the stream's own events.
        await imageEmits;
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
    exitCode = await settleProcessStreams(proc, readers, input.signal);
    await imageEmits;
  } finally {
    imageWatcher?.close();
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
