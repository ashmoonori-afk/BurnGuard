import { expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClaudeCode } from "../src/adapters/claude-code/runner";
import { closeOwnedProcess, spawnOwnedProcess } from "../src/adapters/owned-process";
import { settleProcessStreams } from "../src/adapters/process-streams";
import { describeOwnedProcess, reapRecordedProcess } from "../src/adapters/owned-process-record";
import { closeOwnedProcessTree, OwnedProcessTreeCleanupError, ownedProcessSpawnOptions, terminateOwnedProcessTree } from "../src/adapters/owned-process-tree";
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

// Skipped on Windows: needs POSIX shebang executables and signals; Windows ownership is covered by owned-process-windows.test.ts and codex-runner.test.ts.
test.skipIf(process.platform === "win32")("Given an adapter exits with a surviving child When its result resolves Then the owned process tree is absent before publication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-adapter-tree-"));
  const binary = path.join(root, "adapter-fixture");
  const childScript = "await new Promise(() => {})";
  await writeFile(binary, `#!/usr/bin/env bun\nif(process.argv[2]==="--help"){console.log("  --include-partial-messages");process.exit(0);}\nconst child=Bun.spawn([process.execPath,"-e",${JSON.stringify(childScript)}],{stdin:"ignore",stdout:"ignore",stderr:"ignore"});child.unref();console.log(child.pid);\n`);
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

test("Given a claude-code run in a private project directory When the runner logs its launch Then the log omits the absolute project path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-adapter-log-"));
  const logged: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  try {
    // `process.execPath` stands in for the CLI: the runner logs its spawn line
    // before touching the child, so the process only needs to exist and exit.
    await runClaudeCode({ binaryPath: process.execPath, projectDir: root, prompt: "test", onStdoutLine: () => {} }).catch(() => undefined);
  } finally {
    spy.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
  expect(logged.some((line) => line.startsWith("[claude-code] spawn"))).toBe(true);
  expect(logged.some((line) => line.includes(root))).toBe(false);
});

// Skipped on Windows: needs POSIX shebang executables and signals; Windows ownership is covered by owned-process-windows.test.ts and codex-runner.test.ts.
test.skipIf(process.platform === "win32")("Given an adapter run that is aborted mid-stream When the run settles Then the owned process tree is gone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-adapter-abort-"));
  const binary = path.join(root, "abort-fixture");
  const childScript = "await new Promise(() => {})";
  // The fixture root never exits on its own — only the abort teardown can
  // end this run, which is exactly the path the interrupt handler owns.
  await writeFile(binary, `#!/usr/bin/env bun\nif(process.argv[2]==="--help"){console.log("  --include-partial-messages");process.exit(0);}\nconst child=Bun.spawn([process.execPath,"-e",${JSON.stringify(childScript)}],{stdin:"ignore",stdout:"ignore",stderr:"ignore"});child.unref();console.log(child.pid);\nawait new Promise(() => {});\n`);
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

// POSIX-only: the hung fixture is an executable shell script; Windows covers abort through the injected-probe unit test.
test.skipIf(process.platform === "win32")("Given a turn cancelled while the capability probe hangs When the run starts Then it settles without waiting for the probe timeout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-probe-abort-"));
  const binary = path.join(root, "hung-help-fixture");
  // Every invocation, including --help, never exits on its own.
  await writeFile(binary, `#!/usr/bin/env bun\nawait new Promise(() => {});\n`);
  await chmod(binary, 0o700);
  const controller = new AbortController();
  controller.abort();
  try {
    const result = await runClaudeCode({ binaryPath: binary, projectDir: root, prompt: "test", signal: controller.signal, onStdoutLine: () => {} });
    expect(typeof result.exitCode).toBe("number");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("Given a POSIX process already exited When its owned tree is closed Then cleanup resolves instead of throwing", async () => {
  const proc = Bun.spawn({ cmd: [process.execPath, "-e", "process.exit(0)"], stdout: "ignore", stderr: "ignore", ...ownedProcessSpawnOptions() });
  const processId = proc.pid;
  await proc.exited;
  expect(await closeOwnedProcessTree(processId)).toBeUndefined();
});

test.skipIf(process.platform === "win32")("Given a PATH without ps When an owned child that started a same-group grandchild exits 0 Then settleProcessStreams resolves 0 and the grandchild is gone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-no-ps-"));
  // The owned child records its same-group grandchild's pid in a file and exits 0; the harness reports one JSON line.
  const childSource = `const g=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1e9)'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});g.unref();await Bun.write('grandchild.pid',String(g.pid));`;
  const harness = `import { spawnOwnedProcess } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/adapters/owned-process.ts"))};
    import { settleProcessStreams } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/adapters/process-streams.ts"))};
    const owned=spawnOwnedProcess({cmd:[process.execPath,'-e',${JSON.stringify(childSource)}],stdin:'ignore',stdout:'ignore',stderr:'ignore'});
    let code=null;try{code=await settleProcessStreams(owned,[]);}catch{}
    const grandchild=Number(await Bun.file('grandchild.pid').text());
    let alive=true;try{process.kill(grandchild,0);}catch{alive=false;}
    console.log(JSON.stringify({psMissing:Bun.which('ps')===null,grandchild,code,alive}));`;
  const proc = Bun.spawn([process.execPath, "-e", harness], { cwd: root, env: { PATH: root }, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let report: { psMissing: boolean; grandchild: number; code: number | null; alive: boolean } | undefined;
  try {
    report = JSON.parse(await Promise.race([new Response(proc.stdout).text(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Harness deadline")), 15_000); })]));
    expect(report).toMatchObject({ psMissing: true, code: 0, alive: false });
    expect(report!.grandchild).toBeGreaterThan(0);
  } finally {
    clearTimeout(timer);
    if (report?.alive) { try { process.kill(report.grandchild, "SIGKILL"); } catch { /* already gone */ } }
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test.skipIf(process.platform !== "win32")("Given only a bare Windows PID When cleanup is requested Then opaque ownership is required", async () => {
  await expect(closeOwnedProcessTree(1_000_000_000)).rejects.toBeInstanceOf(OwnedProcessTreeCleanupError);
});

test("Given recovery requires termination proof When signalling is refused Then cleanup rejects rather than reporting success", async () => {
  if (process.platform === "win32") {
    await expect(closeOwnedProcessTree(1_000_000_000, { requireTermination: true })).rejects.toBeInstanceOf(OwnedProcessTreeCleanupError);
  } else {
    const kill = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("fixture permission boundary"), { code: "EPERM" });
    });
    try {
      await expect(closeOwnedProcessTree(1_000_000_000, { requireTermination: true })).rejects.toMatchObject({ code: "EPERM" });
    } finally {
      kill.mockRestore();
    }
  }
});

test("Given ownership changed during the process snapshot When cleanup rechecks Then no captured PID receives a signal", async () => {
  if (process.platform === "win32") {
    await expect(closeOwnedProcessTree(1_000_000_000, { requireTermination: true, verifyOwnership: () => false })).rejects.toBeInstanceOf(OwnedProcessTreeCleanupError);
  } else {
    const kill = spyOn(process, "kill").mockImplementation(() => { throw new Error("Unrelated PID must not be signalled"); });
    let verified = false;
    try {
      await closeOwnedProcessTree(1_000_000_000, { requireTermination: true, verifyOwnership: () => { verified = true; return false; } });
      expect(verified).toBe(true);
      expect(kill.mock.calls).toEqual([]);
    } finally {
      kill.mockRestore();
    }
  }
});

test("Given a real owned child When recording ownership fails Then settlement terminates the child before rejecting", async () => {
  const owned = spawnOwnedProcess({ cmd: [process.execPath, "-e", "Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('fixture')})"], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const readers = [new Response(owned.proc.stdout).text().then(() => {}), new Response(owned.proc.stderr).text().then(() => {})];
  try {
    await expect(settleProcessStreams(owned, readers, undefined, () => { throw new Error("ownership write refused"); })).rejects.toThrow("ownership write refused");
    expect(() => process.kill(owned.proc.pid, 0)).toThrow();
  } finally {
    owned.proc.kill();
    await Promise.allSettled([owned.proc.exited, ...readers]);
  }
});

test("Given persisted ownership When a real child finishes Then cleanup acknowledgement follows child exit", async () => {
  const owned = spawnOwnedProcess({ cmd: [process.execPath, "-e", "console.log('fixture')"], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const readers = [new Response(owned.proc.stdout).text().then(() => {}), new Response(owned.proc.stderr).text().then(() => {})];
  const acknowledged: number[] = [];
  try {
    expect(await settleProcessStreams(owned, readers, undefined, (started) => {
      expect(started.proc.pid).toBe(owned.proc.pid);
      return () => {
        expect(() => process.kill(owned.proc.pid, 0)).toThrow();
        acknowledged.push(owned.proc.pid);
      };
    })).toBe(0);
    expect(acknowledged).toEqual([owned.proc.pid]);
  } finally {
    owned.proc.kill();
    await Promise.allSettled([owned.proc.exited, ...readers]);
  }
});

test("Given an owned root that exited with a quiet descendant When recovering its receipt Then root absence does not leave the writer alive", async () => {
  const childSource = "Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('writer')});console.log(process.pid);";
  const source = `const child=Bun.spawn([process.execPath,'-e',${JSON.stringify(childSource)}],{stdin:'ignore',stdout:'pipe',stderr:'ignore'});const reader=child.stdout.getReader();let text='';while(!text.includes('\\n')){const part=await reader.read();if(part.done)throw new Error('Child readiness missing');text+=new TextDecoder().decode(part.value);}console.log(text.trim());process.exit(0);`;
  const owned = spawnOwnedProcess({ cmd: [process.execPath, "-e", source], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const record = describeOwnedProcess(owned);
  const output = new Response(owned.proc.stdout).text();
  const stderr = new Response(owned.proc.stderr).text();
  const sentinel = Bun.spawn([process.execPath, "-e", "Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('sentinel')})"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let childPid = 0;
  try {
    const text = await Promise.race([output, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Root exit deadline")), 10_000); })]);
    childPid = Number(text.trim());
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    expect(await owned.proc.exited).toBe(0);
    if (record === null) throw new Error("Fixture ownership missing");
    if (process.platform !== "win32") expect(() => process.kill(childPid, 0)).not.toThrow();
    await reapRecordedProcess(record);
    expect(() => process.kill(childPid, 0)).toThrow();
    expect(() => process.kill(sentinel.pid, 0)).not.toThrow();
  } finally {
    clearTimeout(timer);
    await closeOwnedProcess(owned, { timeoutMs: 3_000 });
    owned.proc.kill();
    sentinel.kill();
    if (childPid > 0) { try { process.kill(childPid, "SIGKILL"); } catch { /* already gone */ } }
    await Promise.allSettled([owned.proc.exited, sentinel.exited, output, stderr]);
  }
}, 20_000);

// Skipped on Windows: needs POSIX shebang executables and signals; Windows ownership is covered by owned-process-windows.test.ts and codex-runner.test.ts.
test.skipIf(process.platform === "win32")("POSIX cleanup reports a permission boundary without rejecting an asynchronous abort handler", async () => {
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
