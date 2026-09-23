import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ulid } from "ulid";
import type { NormalizedEvent } from "@bg/shared";
import { PathBoundaryError, resolveWithin } from "../../security/path-boundary";
import type { AdapterRunInput, AdapterRunResult } from "../types";
import { mapGeneratedImages } from "./event-mapping";
import { parseCodexLine, type CodexParserContext } from "./parser";
import { spawnOwnedProcess } from "../owned-process";
import { settleProcessStreams } from "../process-streams";

export function buildCodexCommand(
  binaryPath: string,
  generation?: AdapterRunInput["generation"],
  platform = process.platform,
  imageGeneration: NonNullable<AdapterRunInput["imageGeneration"]> = "allowed",
): string[] {
  return [
    binaryPath,
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "-c", `model_reasoning_effort="${generation?.effort ?? "low"}"`,
    // Ask for the exposed reasoning summary explicitly. `model_reasoning_summary` defaults to the
    // model catalog's own setting, which may expose nothing, and `--ignore-user-config` below drops
    // any value the user configured - so a turn that reasons for minutes between tool calls would
    // put nothing on the stream and look stalled. "concise" is the smallest exposed summary Codex
    // offers; the raw and encrypted chain of thought is never requested and never read.
    "-c", 'model_reasoning_summary="concise"',
    "-c", "suppress_unstable_features_warning=true",
    // A repair edits an artifact that is already finished; the capability is switched off rather
    // than merely discouraged in the prompt.
    "-c", `features.image_generation=${imageGeneration === "forbidden" ? "false" : "true"}`,
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

  const owned = spawnOwnedProcess({
    cmd: buildCodexCommand(input.binaryPath, input.generation, process.platform, input.imageGeneration ?? "allowed"),
    cwd: input.projectDir,
    stdin: new Blob([input.prompt]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const proc = owned.proc;

  // The built-in image tool is silent on the stream for the whole generation (35-60 s each), so a
  // run that draws several images in a row looks stalled to the turn's idle detector. Watching the
  // thread's generated_images directory surfaces each image as an `image_generation` call the
  // moment it lands; the same events carry the provenance hashes the logo gate needs.
  //
  // Parsing mutates hash deduplication state, so it belongs in the same queue as delivery.
  // A failed batch is terminal: its context is never swept/reused as successful provenance.
  let queue: Promise<void> = Promise.resolve();
  let failure: { readonly error: unknown } | undefined;
  const deliveryFailed = Promise.withResolvers<void>();
  let accepting = true;
  let imageWatcher: FSWatcher | undefined;
  let rootWatcher: FSWatcher | undefined;
  const closeIntake = () => {
    accepting = false;
    imageWatcher?.close();
    rootWatcher?.close();
  };
  const fail = (error: unknown) => {
    if (failure !== undefined) return;
    failure = { error };
    closeIntake();
    deliveryFailed.reject(error);
  };
  const enqueue = (produce: () => readonly NormalizedEvent[]): Promise<void> => {
    if (!accepting) return queue;
    queue = queue.then(async () => {
      if (failure !== undefined) return;
      for (const event of produce()) {
        if (failure !== undefined) return;
        if (event.type === "status.idle") sawIdle = true;
        if (event.type === "chat.message_end") sawMessageEnd = true;
        await input.onEvent(event);
      }
    }).catch(fail);
    return queue;
  };
  const scanImages = () => enqueue(() => mapGeneratedImages(ctx));
  const watchGeneratedImages = () => {
    if (!accepting || ctx.codexHome === undefined || ctx.threadId === undefined) return;
    const threadId = ctx.threadId;
    try {
      // Subscribe to the parent BEFORE attempting attachment, closing the create-before-watch gap.
      if (rootWatcher === undefined) {
        const watcher = watch(resolveWithin(ctx.codexHome), (_type, name) => {
          if (name === null || name === "generated_images") watchGeneratedImages();
        });
        rootWatcher = watcher;
        watcher.on("error", () => {
          watcher.close();
          if (rootWatcher === watcher) rootWatcher = undefined;
          watchGeneratedImages();
        });
      }
      if (imageWatcher !== undefined) return;
      // Do not observe a generated_images symlink that escapes the scanner's boundary.
      const watcher = watch(resolveWithin(ctx.codexHome, "generated_images"), { recursive: true }, (_type, name) => {
        if (name === null || (typeof name === "string" && name.includes(threadId))) void scanImages();
      });
      imageWatcher = watcher;
      watcher.on("error", () => {
        watcher.close();
        if (imageWatcher === watcher) imageWatcher = undefined;
        watchGeneratedImages();
      });
      // Includes anything saved between thread.started and attachment/recovery.
      void scanImages();
    } catch (error) {
      // Missing roots retry on the parent notification; escaped roots remain unobserved.
      if (error instanceof PathBoundaryError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return;
      fail(error);
    }
  };

  let exitCode: number;
  try {
    const readers = [
      readLines(proc.stdout, (line) => enqueue(() => {
        // The parser itself tolerates malformed JSON; unexpected failures must settle the owner.
        const events = parseCodexLine(line, ctx);
        watchGeneratedImages();
        return events;
      })),
      readLines(proc.stderr, async (line) => {
        if (failure === undefined) await input.onStderr?.(line);
      }),
    ].map((reader) => reader.catch((error: unknown) => { fail(error); throw error; }));
    // A watcher callback can fail while stdout is silent. Treat that failure as a reader failure
    // so settlement kills the owned writer before waiting for its pipes, not after natural exit.
    const drained = Promise.all(readers).then(() => undefined);
    exitCode = await settleProcessStreams(owned, [...readers, Promise.race([drained, deliveryFailed.promise])], input.signal);
    closeIntake();
    await queue;
  } catch (error) {
    fail(error);
    throw failure === undefined ? error : failure.error;
  } finally {
    closeIntake();
    await queue;
    // Always release the decision sink — see the matching comment in
    // the Claude Code adapter. A throw between subscribe and here
    // would otherwise leak the listener into the broker.
    unsubscribeDecision?.();
  }
  if (failure !== undefined) throw failure.error;

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
