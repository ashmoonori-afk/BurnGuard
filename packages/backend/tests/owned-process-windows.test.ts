import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeOwnedProcess, OwnedProcessHostError, settleOwnedProcess, spawnOwnedProcess, terminateOwnedWindowsJob, type WindowsJobOwnership, windowsOwnedLaunchCommand } from "../src/adapters/owned-process";

const jobToken = "a".repeat(32);

function asyncReceiptChange(): { readonly promise: Promise<number>; readonly cancel: () => void } {
  return { promise: Promise.resolve(1), cancel: () => {} };
}

function testWindowsOwnership(onDispose: () => void = () => {}): WindowsJobOwnership {
  return {
    kind: "windows-job", token: jobToken, helperPath: "C:\\BurnGuard\\burnguard-windows-process-host.exe",
    receiptRoot: "/tmp/bg-owned-test", launchReceipt: "/tmp/bg-owned-test/launch.json", terminateReceipt: "/tmp/bg-owned-test/terminate.json",
    receiptVersion: () => 1, waitForReceiptChange: asyncReceiptChange, closeWatcher: onDispose,
  };
}

const runningReceipt = JSON.stringify({ schema_version: 1, operation: "launch", state: "running", job_token: jobToken, host_pid: 50, target_pid: 51, active_processes: 2 });
const finalReceipt = JSON.stringify({ schema_version: 1, operation: "launch", state: "exited", job_token: jobToken, host_pid: 50, target_pid: 51, target_exit_code: 17, active_processes: 0 });
const terminatedReceipt = JSON.stringify({ schema_version: 1, operation: "terminate", state: "terminated", job_token: jobToken, active_processes: 0 });

test("Windows owned host launch keeps target argv after an opaque control prefix", () => {
  const ownership = testWindowsOwnership();
  expect(windowsOwnedLaunchCommand(ownership, ["provider.exe", "--stream"])).toEqual([
    ownership.helperPath, "launch", "--job", jobToken, "--receipt", ownership.launchReceipt, "--", "provider.exe", "--stream",
  ]);
});

for (const scenario of [
  { name: "wrong job", exitCode: 0, receipt: JSON.stringify({ schema_version: 1, operation: "terminate", state: "terminated", job_token: "b".repeat(32), active_processes: 0 }) },
  { name: "malformed receipt", exitCode: 0, receipt: "not-json" },
  { name: "nonzero helper", exitCode: 7, receipt: "" },
  { name: "nonzero active count", exitCode: 0, receipt: JSON.stringify({ schema_version: 1, operation: "terminate", state: "terminated", job_token: jobToken, active_processes: 1 }) },
] as const) test(`Windows owned host rejects ${scenario.name}`, async () => {
  const ownership = testWindowsOwnership();
  const readReceipt = async (receiptPath: string) => receiptPath === ownership.launchReceipt ? runningReceipt : scenario.receipt;
  await expect(terminateOwnedWindowsJob({ ownership, hostPid: 50, hostExit: new Promise(() => {}), timeoutMs: 2_250, runCommand: async () => ({ exitCode: scenario.exitCode, stdout: "", stderr: "" }), readReceipt })).rejects.toBeInstanceOf(OwnedProcessHostError);
});

test("Windows owned host converts an absent helper into a typed cleanup error", async () => {
  const ownership = testWindowsOwnership();
  await expect(terminateOwnedWindowsJob({ ownership, hostPid: 50, hostExit: new Promise(() => {}), timeoutMs: 2_250, runCommand: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, readReceipt: async () => runningReceipt })).rejects.toBeInstanceOf(OwnedProcessHostError);
});

test("Windows cancellation treats any subscribed directory event as a receipt wakeup hint", async () => {
  const ownership: WindowsJobOwnership = {
    ...testWindowsOwnership(), receiptVersion: () => 0,
    waitForReceiptChange: () => ({ promise: Promise.resolve(1), cancel: () => {} }),
  };
  let launchReads = 0;
  await terminateOwnedWindowsJob({
    ownership, hostPid: 50, hostExit: new Promise(() => {}), timeoutMs: 2_250,
    runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    readReceipt: async (receiptPath) => {
      if (receiptPath === ownership.terminateReceipt) return terminatedReceipt;
      launchReads += 1;
      if (launchReads === 1) throw new Error("atomic receipt not visible yet");
      return runningReceipt;
    },
  });
  expect(launchReads).toBe(2);
});

test("Windows cancellation wakes on host exit and fails typed when no launch receipt exists", async () => {
  const ownership: WindowsJobOwnership = {
    ...testWindowsOwnership(), receiptVersion: () => 0,
    waitForReceiptChange: () => ({ promise: new Promise(() => {}), cancel: () => {} }),
  };
  await expect(terminateOwnedWindowsJob({
    ownership, hostPid: 50, hostExit: Promise.resolve(201), timeoutMs: 2_250,
    runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    readReceipt: async () => { throw new Error("missing receipt"); },
  })).rejects.toMatchObject({ reason: "invalid_receipt" });
});

test("Windows terminate forwards the exact budget remaining after launch authority", async () => {
  const ownership = testWindowsOwnership();
  const times = [1_000, 1_250];
  let commandTimeout = 0;
  let command: readonly string[] = [];
  await terminateOwnedWindowsJob({
    ownership, hostPid: 50, hostExit: new Promise(() => {}), timeoutMs: 2_250,
    now: () => times.shift() ?? 1_250,
    runCommand: async (value, timeoutMs) => { command = value; commandTimeout = timeoutMs; return { exitCode: 0, stdout: "", stderr: "" }; },
    readReceipt: async (receiptPath) => receiptPath === ownership.launchReceipt ? runningReceipt : terminatedReceipt,
  });
  expect(commandTimeout).toBe(2_000);
  expect(command.slice(-2)).toEqual(["--timeout-ms", "2000"]);
});

test("Windows launch settlement requires the final exact-token zero-active receipt", async () => {
  const validOwnership = testWindowsOwnership();
  const validOwned = { proc: { pid: 50, exited: Promise.resolve(17), kill: () => {} }, ownership: validOwnership };
  await expect(settleOwnedProcess(validOwned, 17, async () => finalReceipt)).resolves.toBeUndefined();
  const invalidOwnership = testWindowsOwnership();
  const invalidOwned = { proc: { pid: 50, exited: Promise.resolve(17), kill: () => {} }, ownership: invalidOwnership };
  await expect(settleOwnedProcess(invalidOwned, 17, async () => "{}")).rejects.toBeInstanceOf(OwnedProcessHostError);
});

test("Windows host settlement waits for terminate receipt consumption before disposal", async () => {
  const order: string[] = [];
  const ownership = testWindowsOwnership(() => { order.push("dispose"); });
  const hostExit = Promise.withResolvers<number>();
  const control = Promise.withResolvers<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>();
  let forwardedBudget = 0;
  let launchFinal = false;
  const owned = { proc: { pid: 50, exited: hostExit.promise, kill: () => {} }, ownership };
  const close = closeOwnedProcess(owned, {
    timeoutMs: 2_250,
    runCommand: async (_command, timeoutMs) => { forwardedBudget = timeoutMs; return control.promise; },
    now: () => 1_000,
    readReceipt: async (receiptPath) => {
      if (receiptPath === ownership.terminateReceipt) { order.push("terminate-read"); return terminatedReceipt; }
      return launchFinal ? finalReceipt : runningReceipt;
    },
  });
  launchFinal = true;
  hostExit.resolve(17);
  const settled = settleOwnedProcess(owned, 17, async (receiptPath) => {
    if (receiptPath === ownership.terminateReceipt) { order.push("terminate-read"); return terminatedReceipt; }
    order.push("launch-final-read"); return finalReceipt;
  });
  await Promise.resolve();
  expect(order).toEqual([]);
  control.resolve({ exitCode: 0, stdout: "", stderr: "" });
  await Promise.all([close, settled]);
  expect(order).toEqual(["terminate-read", "launch-final-read", "dispose"]);
  expect(forwardedBudget).toBe(2_000);
});

test("Windows rejected control kills the owned launcher, disposes once, and keeps the typed failure", async () => {
  let disposed = 0;
  const ownership = testWindowsOwnership(() => { disposed += 1; });
  const hostExit = Promise.withResolvers<number>();
  let killed = 0;
  const owned = { proc: { pid: 50, exited: hostExit.promise, kill: () => { killed += 1; hostExit.resolve(201); } }, ownership };
  const failure = await closeOwnedProcess(owned, {
    timeoutMs: 2_250,
    runCommand: async () => { throw new Error("missing helper"); },
    readReceipt: async () => runningReceipt,
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(OwnedProcessHostError);
  if (!(failure instanceof OwnedProcessHostError)) throw failure;
  expect(failure.reason).toBe("absent_helper");
  expect(killed).toBe(1);
  expect(disposed).toBe(1);
});

test.skipIf(process.platform !== "win32")("Given an opaque-owned target already exited When settlement runs Then the exact final receipt proves zero active processes", async () => {
  const owned = spawnOwnedProcess({ cmd: [process.execPath, "-e", "process.exit(0)"], stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const exitCode = await owned.proc.exited;
  await expect(settleOwnedProcess(owned, exitCode)).resolves.toBeUndefined();
  expect(exitCode).toBe(0);
});

test.skipIf(process.platform !== "win32")("Given an owned root exits with a live child When the host settles Then the child is gone and an unrelated sentinel survives", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-windows-job-natural-exit-"));
  const childSource = `Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('fixture')});console.log('READY');await new Promise(()=>{})`;
  const targetSource = `const child=Bun.spawn([process.execPath,'-e',${JSON.stringify(childSource)}],{stdin:'ignore',stdout:'pipe',stderr:'ignore'});await child.stdout.getReader().read();console.log(child.pid);`;
  const owned = spawnOwnedProcess({ cmd: [process.execPath, "-e", targetSource], cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const sentinel = Bun.spawn([process.execPath, "-e", childSource], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const targetReader = owned.proc.stdout.getReader();
  const sentinelReader = sentinel.stdout.getReader();
  let childPid = 0;
  try {
    const [targetReady] = await Promise.all([targetReader.read(), sentinelReader.read()]);
    childPid = Number(new TextDecoder().decode(targetReady.value).trim());
    expect(childPid).toBeGreaterThan(0);
    const exitCode = await owned.proc.exited;
    await settleOwnedProcess(owned, exitCode);
    expect(exitCode).toBe(0);
    expect(() => process.kill(childPid, 0)).toThrow();
    expect(() => process.kill(sentinel.pid, 0)).not.toThrow();
  } finally {
    owned.proc.kill("SIGKILL"); sentinel.kill("SIGKILL");
    await Promise.all([owned.proc.exited, sentinel.exited]);
    targetReader.releaseLock(); sentinelReader.releaseLock();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
