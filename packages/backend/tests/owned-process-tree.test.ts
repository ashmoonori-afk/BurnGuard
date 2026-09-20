import { expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClaudeCode } from "../src/adapters/claude-code/runner";
import { spawnOwnedProcess } from "../src/adapters/owned-process";
import { closeOwnedProcessTree, ownedProcessSpawnOptions, terminateOwnedProcessTree } from "../src/adapters/owned-process-tree";
import { awaitChildWithAbort, ExtractionAcquisitionError } from "../src/services/extraction-acquisition";

for (const alreadyAborted of [false, true]) test(`acquisition abort reaps its descendant (already aborted: ${alreadyAborted})`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-acquisition-tree-"));
  const source = `process.on('SIGTERM',()=>{});Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('fixture')});console.log('ready');`;
  const parent = spawnOwnedProcess({ cmd: [process.execPath, "-e", `const child=Bun.spawn([process.execPath,'-e',${JSON.stringify(source)}],{detached:process.platform!=='win32',stdin:'ignore',stdout:'pipe',stderr:'ignore'});await child.stdout.getReader().read();console.log(child.pid);Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('fixture')});`], cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const parentProc = parent.proc;
  const sentinel = Bun.spawn([process.execPath, "-e", source], { cwd: root, stdout: "pipe", stderr: "ignore" });
  const parentReader = parentProc.stdout.getReader(), sentinelReader = sentinel.stdout.getReader();
  const controller = new AbortController();
  let operation: Promise<unknown> | undefined;
  if (!alreadyAborted) operation = awaitChildWithAbort(parent, controller.signal).catch((error: unknown) => error);
  let descendant = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([Promise.all([parentReader.read(), sentinelReader.read()]), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture readiness deadline")), 5000); })]);
    descendant = Number(new TextDecoder().decode(ready[0].value).trim());
    expect(descendant).toBeGreaterThan(0);
    controller.abort();
    operation ??= awaitChildWithAbort(parent, controller.signal).catch((error: unknown) => error);
    const error = await operation;
    expect(error).toBeInstanceOf(ExtractionAcquisitionError);
    if (!(error instanceof ExtractionAcquisitionError)) throw new Error("Expected acquisition cancellation");
    expect(error.cleanupReceipt).toMatchObject({ pid: parentProc.pid, termSent: true, pidAbsent: true });
    if (process.platform !== "win32") expect(error.cleanupReceipt).toMatchObject({ killSent: true });
    expect(() => process.kill(parentProc.pid, 0)).toThrow();
    expect(() => process.kill(descendant, 0)).toThrow();
    expect(() => process.kill(sentinel.pid, 0)).not.toThrow();
  } finally {
    clearTimeout(timer); controller.abort();
    if (descendant && process.platform !== "win32") await closeOwnedProcessTree(descendant);
    parentProc.kill("SIGKILL"); sentinel.kill("SIGKILL");
    await Promise.all([parentProc.exited, sentinel.exited, operation]);
    parentReader.releaseLock(); sentinelReader.releaseLock();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

test.skipIf(process.platform === "win32")("strict POSIX acquisition process cleanup propagates a signalling permission failure", async () => {
  const kill = spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("fixture permission boundary"), { code: "EPERM" }); });
  try { await expect(terminateOwnedProcessTree({ pid: 1_000_000_000, exited: Promise.resolve(0) }, 0, 0)).rejects.toMatchObject({ code: "EPERM" }); }
  finally { kill.mockRestore(); }
});

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
