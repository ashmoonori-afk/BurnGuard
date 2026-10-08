import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared";
import { runClaudeCode } from "../src/adapters/claude-code/runner";
import { runCodexTurn } from "../src/adapters/codex";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../src/adapters/owned-process-tree";

function present(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

async function bounded<T>(signal: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([signal, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Owned fixture did not signal within 5s")), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function firstLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let line = "";
  while (!line.includes("\n")) {
    const next = await reader.read();
    if (next.done) throw new Error("Fixture exited before ready");
    line += decoder.decode(next.value, { stream: true });
  }
  return line.slice(0, line.indexOf("\n"));
}

for (const adapter of ["codex", "claude-code"] as const) {
  test(`Given ${adapter} owns a ready detached descendant When interrupted Then both exit before settlement and an unrelated process survives`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "burnguard-detached-interrupt-"));
    const script = path.join(root, "provider-fixture.cjs");
    await copyFile(path.join(import.meta.dir, "fixtures/detached-descendant.cjs"), script);
    // Windows cannot execute the shebang script: the adapter launches a .cmd wrapper through the process host
    // and the job object, not a process group, is what has to reap the detached descendant.
    let binary = script;
    if (process.platform === "win32") {
      binary = path.join(root, "provider-fixture.cmd");
      await writeFile(binary, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    } else await chmod(script, 0o700);
    const controller = new AbortController();
    const events: NormalizedEvent[] = [];
    let ids: { parent: number; child: number } | undefined;
    // Same executable and cwd, but outside the adapter's ancestry: never a target.
    const control = Bun.spawn(process.platform === "win32" ? [process.execPath, script, "control"] : [binary, "control"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "inherit", ...ownedProcessSpawnOptions() });
    const controlExit = control.exited;
    const controlReader = control.stdout.getReader();
    let run: Promise<unknown> | undefined;
    let completed = false;
    try {
      expect(await bounded(firstLine(controlReader))).toBe(String(control.pid));
      const onLine = (line: string) => {
        const ready: { parent: number; child: number } = JSON.parse(line);
        ids = ready;
        if (process.platform !== "win32") { // Windows has no process groups: the job object membership is asserted by the reaping below.
          const tree = Bun.spawnSync(["ps", "-p", String(ready.child), "-o", "ppid=,pgid="], { stdout: "pipe", timeout: 1_000 });
          expect(tree.exitCode).toBe(0);
          expect(tree.stdout.toString().trim().split(/\s+/).map(Number)).toEqual([ready.parent, ready.child]);
        }
        controller.abort(); // Trigger only after the child's IPC ready signal.
      };
      run = adapter === "codex"
        ? runCodexTurn({ binaryPath: binary, projectDir: root, prompt: "test", signal: controller.signal,
          sessionId: "detached-session", turnId: "detached-turn", userEvent: { type: "user.message", text: "test" },
          onEvent: async (event) => { events.push(event); if (event.type === "chat.delta") onLine(event.text.trim()); } })
        : runClaudeCode({ binaryPath: binary, projectDir: root, prompt: "test", signal: controller.signal, onStdoutLine: onLine });
      await bounded(run);
      assert(ids, "Fixture must report its owned PIDs before interruption");
      expect(present(ids.parent)).toBe(false);
      expect(present(ids.child)).toBe(false);
      expect(present(control.pid)).toBe(true);
      if (adapter === "codex") expect(events.at(-1)).toMatchObject({ type: "status.idle", stopReason: "interrupted" });
      console.log("detached-settlement-receipt", JSON.stringify({ adapter, ...ids, control: control.pid,
        parentAbsent: !present(ids.parent), childAbsent: !present(ids.child), unrelatedPresent: present(control.pid) }));
      completed = true;
    } finally {
      controller.abort();
      // Read the exact receipt even if an assertion in the ready callback failed.
      const receiptPath = path.join(root, "owned-pids.json");
      if (existsSync(receiptPath)) ids = JSON.parse(await readFile(receiptPath, "utf8"));
      if (process.platform === "win32") {
        // A bare PID has no ownership on Windows and PIDs are reused quickly. The control process is killed through
        // its spawn handle; the owned pair (already ended by the adapter's job) is signalled by PID only when the
        // test failed before completing, never after a pass where the PIDs may belong to someone else.
        control.kill();
        if (!completed) for (const pid of [ids?.parent, ids?.child]) if (pid !== undefined && present(pid)) try { process.kill(pid); } catch { /* already exited */ }
      } else {
        if (ids) {
          await closeOwnedProcessTree(ids.parent);
          await closeOwnedProcessTree(ids.child);
        }
        await closeOwnedProcessTree(control.pid);
      }
      await bounded(controlExit);
      if (run) await bounded(run.catch((error: unknown) => { console.error("Fixture run failed during cleanup:", error); }));
      controlReader.releaseLock();
      const receipt = { adapter, root, ...ids, control: control.pid,
        parentAbsent: ids ? !present(ids.parent) : true, childAbsent: ids ? !present(ids.child) : true, controlAbsent: !present(control.pid) };
      console.log("detached-cleanup-receipt", JSON.stringify(receipt));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      expect(receipt.parentAbsent && receipt.childAbsent && receipt.controlAbsent).toBe(true);
    }
  }, 30_000);
}
