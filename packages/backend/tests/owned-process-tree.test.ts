import { expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClaudeCode } from "../src/adapters/claude-code/runner";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../src/adapters/owned-process-tree";

test("Given an adapter exits with a surviving child When its result resolves Then the owned process tree is absent before publication", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-adapter-tree-"));
  const binary = path.join(root, "adapter-fixture");
  const childScript = "await new Promise(() => {})";
  await writeFile(binary, `#!/usr/bin/env bun\nconst child=Bun.spawn([process.execPath,"-e",${JSON.stringify(childScript)}],{stdin:"ignore",stdout:"ignore",stderr:"ignore"});child.unref();console.log(child.pid);\n`);
  await chmod(binary, 0o700);
  let childPid = 0;
  try {
    const result = await runClaudeCode({ binaryPath: binary, projectDir: root, prompt: "test", onStdoutLine: (line) => { childPid = Number(line); } });
    expect(result.exitCode).toBe(0);
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    expect(() => process.kill(childPid, 0)).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Given an adapter run that is aborted mid-stream When the run settles Then the owned process tree is gone", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-adapter-abort-"));
  const binary = path.join(root, "abort-fixture");
  const childScript = "await new Promise(() => {})";
  // The fixture root never exits on its own — only the abort teardown can
  // end this run, which is exactly the path the interrupt handler owns.
  await writeFile(binary, `#!/usr/bin/env bun\nconst child=Bun.spawn([process.execPath,"-e",${JSON.stringify(childScript)}],{stdin:"ignore",stdout:"ignore",stderr:"ignore"});child.unref();console.log(child.pid);\nawait new Promise(() => {});\n`);
  await chmod(binary, 0o700);
  const controller = new AbortController();
  let childPid = 0;
  try {
    await runClaudeCode({ binaryPath: binary, projectDir: root, prompt: "test", signal: controller.signal, onStdoutLine: (line) => { childPid = Number(line); controller.abort(); } });
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    expect(() => process.kill(childPid, 0)).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Given a process that already exited When its owned tree is closed Then cleanup resolves instead of throwing", async () => {
  const proc = Bun.spawn({ cmd: [process.execPath, "-e", "process.exit(0)"], stdout: "ignore", stderr: "ignore", ...ownedProcessSpawnOptions() });
  const processId = proc.pid;
  await proc.exited;
  expect(await closeOwnedProcessTree(processId)).toBeUndefined();
});

test("POSIX cleanup reports a permission boundary without rejecting an asynchronous abort handler", async () => {
  if (process.platform === "win32") return;
  const kill = spyOn(process, "kill").mockImplementation((_pid, signal) => {
    throw Object.assign(new Error("signal failure"), { code: signal === "SIGKILL" ? "EPERM" : "ESRCH" });
  });
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await closeOwnedProcessTree(1_000_000_000)).toBeUndefined();
    expect(warning.mock.calls.some(([message]) => String(message).includes("EPERM"))).toBe(true);
  } finally {
    kill.mockRestore();
    warning.mockRestore();
  }
});
