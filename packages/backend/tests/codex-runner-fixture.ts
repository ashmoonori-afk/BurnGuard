import { spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared";
import { runCodexTurn } from "../src/adapters/codex";
import type { AdapterRunInput } from "../src/adapters/types";

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const PNG_SHA = createHash("sha256").update(PNG).digest("hex");
const THREAD_ID = "01a0bd75-12bd-75a3-8193-127dd61ddb33";

/** A live notification source, not a native watcher closed before the test starts. */
class ControlledWatcher extends EventEmitter implements fs.FSWatcher {
  closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => super.emit("close"));
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (this.closed && (event === "change" || event === "error")) return false;
    return super.emit(event, ...args);
  }

  ref(): this { return this; }
  unref(): this { return this; }
}

/** Real owned child and real hash reads; only OS notification scheduling is controlled when requested. */
export async function codexFixture(options: { readonly missingRoot?: boolean; readonly controlledWatch?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-codex-runner-"));
  const home = path.join(root, "codex-home");
  const imageRoot = path.join(home, "generated_images");
  const threadDir = path.join(imageRoot, THREAD_ID);
  const script = path.join(root, process.platform === "win32" ? "codex-fixture.mjs" : "codex-fixture");
  await mkdir(options.missingRoot ? home : imageRoot, { recursive: true });
  await writeFile(script, [
    "#!/usr/bin/env bun",
    'import { existsSync, watch } from "node:fs";',
    `const root = ${JSON.stringify(root)};`,
    // Keep a descendant alive too, so callback failure tests exercise owned tree teardown.
    'const child = Bun.spawn([process.execPath, "-e", "process.stdin.resume()"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });',
    'let reported = false;',
    'const completed = new Promise(resolve => {',
    '  const check = () => {',
    '    if (!reported && existsSync(root + "/stderr")) { reported = true; console.error("fixture-stderr"); }',
    '    if (existsSync(root + "/complete")) { watcher.close(); resolve(); }',
    '  };',
    '  const watcher = watch(root, check); check();',
    '});',
    `console.log(JSON.stringify({ type: "thread.started", thread_id: ${JSON.stringify(THREAD_ID)} }));`,
    'console.log(JSON.stringify({ type: "text", text: JSON.stringify({ pid: process.pid, childPid: child.pid }) }));',
    'await completed;',
    'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));',
    'child.stdin.end(); await child.exited;',
    "",
  ].join("\n"));
  // Windows cannot execute an extensionless shebang script: launch it through a .cmd wrapper, the shape
  // production resolves for codex there. The wrapper is also an extra ancestor the job object must reap.
  let binary = script;
  if (process.platform === "win32") {
    binary = path.join(root, "codex-fixture.cmd");
    await writeFile(binary, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else await chmod(script, 0o700);
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  const watches: { readonly path: string; readonly watcher: fs.FSWatcher; closed: boolean }[] = [];
  const parentAttached = Promise.withResolvers<void>();
  const imageAttached = Promise.withResolvers<void>();
  const imageCallbackEntered = Promise.withResolvers<void>();
  const stderrRejected = Promise.withResolvers<void>();
  const intakeClosed = Promise.withResolvers<void>();
  const nativeWatch = fs.watch;
  const watchSpy = spyOn(fs, "watch").mockImplementation((
    filename: fs.PathLike,
    watchOptions?: fs.WatchOptions | BufferEncoding | "buffer" | null | fs.WatchListener<string>,
    listener?: fs.WatchListener<string> | fs.WatchListener<NonSharedBuffer>,
  ) => {
    const callback = typeof watchOptions === "function" ? watchOptions : listener;
    const settings = typeof watchOptions === "function" ? null : watchOptions ?? null;
    const observesImages = String(filename) === home || String(filename) === imageRoot;
    let watcher: fs.FSWatcher;
    if (options.controlledWatch && observesImages) {
      fs.statSync(filename); // Preserve native ENOENT behavior for the missing-root schedule.
      watcher = new ControlledWatcher();
    } else watcher = nativeWatch(filename, settings);
    if (callback) watcher.on("change", callback);
    // Ownership receipts and every other native watch retain their callback and lifetime.
    if (!observesImages) return watcher;
    const entry = { path: String(filename), watcher, closed: false };
    watches.push(entry);
    watcher.once("close", () => {
      entry.closed = true;
      if (watches.every((entry) => entry.closed)) intakeClosed.resolve();
    });
    if (String(filename) === home) parentAttached.resolve();
    if (String(filename) === imageRoot) imageAttached.resolve();
    return watcher;
  });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 20_000);
  const ready = Promise.withResolvers<void>();
  const events: NormalizedEvent[] = [];
  let pids: number[] = [];
  let outcome: Promise<unknown> | undefined;
  let settled = false;
  const observe = (signal: Promise<void>, milestone: string) => {
    if (outcome === undefined) throw new Error("fixture not started");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`fixture milestone not reached: ${milestone}`)), 5_000);
    });
    return Promise.race([
      signal,
      outcome.then((result) => { throw new Error(`child exited before ${milestone}`, { cause: result }); }),
      timeout,
    ]).finally(() => clearTimeout(timer));
  };
  return {
    root, home, imageRoot, threadDir, watches, events, controller,
    get ready() { return observe(ready.promise, "ready"); },
    get parentAttached() { return observe(parentAttached.promise, "parent watcher attached"); },
    get imageAttached() { return observe(imageAttached.promise, "image watcher attached"); },
    get imageCallbackEntered() { return observe(imageCallbackEntered.promise, "image callback entered"); },
    get stderrRejected() { return observe(stderrRejected.promise, "stderr callback rejected"); },
    get intakeClosed() { return observe(intakeClosed.promise, "watcher intake closed"); },
    get pids() { return pids; },
    get settled() { return settled; },
    start(callbacks: Pick<AdapterRunInput, "onEvent" | "onStderr"> = { onEvent: async () => {} }) {
      outcome = runCodexTurn({
        sessionId: "fixture-session", turnId: "fixture-turn", projectDir: root, binaryPath: binary,
        prompt: "test", userEvent: { type: "user.message", text: "test" }, signal: controller.signal,
        onEvent: async (event) => {
          events.push(event);
          if (event.type === "chat.delta") {
            const value: unknown = JSON.parse(event.text);
            if (typeof value === "object" && value !== null && "pid" in value && "childPid" in value && typeof value.pid === "number" && typeof value.childPid === "number") pids = [value.pid, value.childPid];
            ready.resolve();
          }
          if (event.type === "tool.started") imageCallbackEntered.resolve();
          await callbacks.onEvent(event);
        },
        onStderr: async (line) => {
          try { await callbacks.onStderr?.(line); }
          catch (error) { stderrRejected.resolve(); throw error; }
        },
      }).then((result) => { settled = true; return result; }, (error: unknown) => { settled = true; return error; });
      return outcome;
    },
    async image() {
      await mkdir(threadDir, { recursive: true });
      // Native delivery must never hash a partially written PNG.
      const staged = path.join(threadDir, "exec-1.tmp");
      await writeFile(staged, PNG);
      await rename(staged, path.join(threadDir, "exec-1.png"));
    },
    async command(name: "complete" | "stderr") { await writeFile(path.join(root, name), "go"); },
    async [Symbol.asyncDispose]() {
      controller.abort();
      await outcome;
      clearTimeout(deadline);
      for (const { watcher } of watches) watcher.close();
      watchSpy.mockRestore();
      if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
