import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPortFree } from "./port";

interface NativeSmokeReport {
  readonly nativeWindowVisible: boolean;
  readonly windowTitle: string;
  readonly pageTitle: string;
  readonly bodyTextLength: number;
  readonly backendUrl: string;
  readonly backendPid: number;
  readonly canvasReady: boolean;
  readonly downloadCompleted: boolean;
  readonly snapshotCaptured: boolean;
}

interface ProcessEntry {
  readonly pid: number;
  readonly command: string;
}

const appPath = process.argv[2];
const evidenceDirectory = process.argv[3];
if (appPath === undefined || process.platform !== "darwin") {
  throw new Error("Usage on macOS: bun scripts/qa/native-mac-smoke.ts <BurnGuard.app path> [evidence directory]");
}

const port = await findPort(14220);
const profile = await mkdtemp(path.join(tmpdir(), "burnguard-native-mac-"));
const reportPath = path.join(profile, "native-smoke.json");
let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  const before = await processSnapshot();
  child = Bun.spawn([path.join(appPath, "Contents/MacOS/BurnGuard"), "--smoke-test", "--smoke-report", reportPath], {
    env: { ...process.env, BG_APP_ROOT: profile, BG_PORT: String(port), BG_NO_OPEN: "1" },
    detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timeout = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error("Native smoke exceeded its 400-second deadline")), 400_000);
  });
  const [exitCode] = await Promise.race([
    Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]), timeout,
  ]);
  const report = JSON.parse(await readFile(reportPath, "utf8")) as NativeSmokeReport;
  const after = await processSnapshot();
  const launchedBrowsers = after.filter(entry => !before.some(previous => previous.pid === entry.pid) && /Google Chrome\.app|\/Chromium|chrome_crashpad/i.test(entry.command));
  console.log(JSON.stringify({ report, launchedBrowsers, exitCode }));
  assert.equal(exitCode, 0, "Native shell must exit successfully");
  assert.equal(report.nativeWindowVisible, true, "Native window must be visible");
  assert.equal(report.windowTitle, "BurnGuard Design");
  assert.equal(report.pageTitle, "BurnGuard Design");
  assert.ok(report.bodyTextLength >= 40);
  assert.equal(report.canvasReady, true, "Sandboxed srcdoc must execute and reply from an opaque origin");
  assert.equal(report.downloadCompleted, true, "The trusted blob must finish as a native download");
  assert.equal(await readFile(path.join(profile, "native-smoke-download.txt"), "utf8"), "burnguard-native-download\n");
  assert.equal(report.snapshotCaptured, true);
  assert.equal(launchedBrowsers.length, 0, "Native smoke must not launch an external browser");
  assert.ok(report.backendPid > 0 && !after.some(entry => entry.pid === report.backendPid), "Owned backend must exit before profile cleanup");
} finally {
  clearTimeout(deadline);
  try {
    if (child) await stopChild(child);
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      for (const name of await readdir(profile)) {
        if (["native-smoke.json", "native-smoke.json.png", "native-smoke-download.txt"].includes(name)) {
          await copyFile(path.join(profile, name), path.join(evidenceDirectory, name));
        }
      }
    }
  } finally { await rm(profile, { recursive: true, force: true }); }
}

async function stopChild(processHandle: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
  try { process.kill(-processHandle.pid, "SIGKILL"); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
  await processHandle.exited;
}

async function findPort(start: number): Promise<number> {
  for (let port = start; port < 65_536; port += 1) if (await isPortFree(port)) return port;
  throw new Error("No free QA port is available");
}

async function processSnapshot(): Promise<readonly ProcessEntry[]> {
  const processList = Bun.spawn(["ps", "-axo", "pid=,command="], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(processList.stdout).text();
  assert.equal(await processList.exited, 0, "Process snapshot must succeed");
  return output.split("\n").map(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    return match === null ? null : { pid: Number(match[1]), command: match[2] };
  }).filter((entry): entry is ProcessEntry => entry !== null);
}
