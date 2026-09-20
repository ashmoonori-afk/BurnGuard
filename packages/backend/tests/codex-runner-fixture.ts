import { spyOn } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared";
import { runCodexTurn } from "../src/adapters/codex";
import type { AdapterRunInput } from "../src/adapters/types";

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const PNG_SHA = createHash("sha256").update(PNG).digest("hex");
const THREAD_ID = "01a0bd75-12bd-75a3-8193-127dd61ddb33";

/** Real owned child and real hash reads; only OS notification scheduling is controlled when requested. */
export async function codexFixture(options: { readonly missingRoot?: boolean; readonly controlledWatch?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-codex-runner-"));
  const home = path.join(root, "codex-home");
  const imageRoot = path.join(home, "generated_images");
  const threadDir = path.join(imageRoot, THREAD_ID);
  const binary = path.join(root, "codex-fixture");
  await mkdir(options.missingRoot ? home : imageRoot, { recursive: true });
  await writeFile(binary, [
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
  await chmod(binary, 0o700);
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  const watches: { readonly path: string; readonly watcher: fs.FSWatcher }[] = [];
  const imageAttached = Promise.withResolvers<void>();
  const nativeWatch = fs.watch;
  const watchSpy = spyOn(fs, "watch").mockImplementation((
    filename: fs.PathLike,
    watchOptions?: fs.WatchOptions | BufferEncoding | "buffer" | null | fs.WatchListener<string>,
    listener?: fs.WatchListener<string> | fs.WatchListener<NonSharedBuffer>,
  ) => {
    const callback = typeof watchOptions === "function" ? watchOptions : listener;
    const settings = typeof watchOptions === "function" ? null : watchOptions ?? null;
    const watcher = nativeWatch(filename, settings, () => {});
    if (options.controlledWatch) watcher.close();
    if (callback) watcher.on("change", callback);
    watches.push({ path: String(filename), watcher });
    if (String(filename) === imageRoot) imageAttached.resolve();
    return watcher;
  });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 5_000);
  const ready = Promise.withResolvers<void>();
  const events: NormalizedEvent[] = [];
  let pids: number[] = [];
  let outcome: Promise<unknown> | undefined;
  let settled = false;
  return {
    root, home, imageRoot, threadDir, watches, events, controller,
    get ready() {
      if (outcome === undefined) throw new Error("fixture not started");
      return Promise.race([ready.promise, outcome.then(() => { throw new Error("child exited before ready"); })]);
    },
    get imageAttached() {
      if (outcome === undefined) throw new Error("fixture not started");
      return Promise.race([imageAttached.promise, outcome.then(() => { throw new Error("child exited before image watcher attached"); })]);
    },
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
          await callbacks.onEvent(event);
        },
        onStderr: callbacks.onStderr,
      }).then((result) => { settled = true; return result; }, (error: unknown) => { settled = true; return error; });
      return outcome;
    },
    async image() {
      await mkdir(threadDir, { recursive: true });
      await writeFile(path.join(threadDir, "exec-1.png"), PNG);
    },
    async command(name: "complete" | "stderr") { await writeFile(path.join(root, name), "go"); },
    async [Symbol.asyncDispose]() {
      controller.abort();
      await outcome;
      clearTimeout(deadline);
      for (const { watcher } of watches) watcher.close();
      watchSpy.mockRestore();
      if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
      await rm(root, { recursive: true, force: true });
    },
  };
}
