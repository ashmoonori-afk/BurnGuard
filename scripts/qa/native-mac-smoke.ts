import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPortFree } from "./port";

interface NativeSmokeReport {
  readonly nativeWindowVisible: boolean;
  readonly windowTitle: string;
  readonly pageTitle: string;
  readonly bodyTextLength: number;
  readonly backendUrl: string;
}

interface ProcessEntry {
  readonly pid: number;
  readonly command: string;
}

const appPath = process.argv[2];
if (appPath === undefined || process.platform !== "darwin") {
  throw new Error("Usage on macOS: bun scripts/qa/native-mac-smoke.ts <BurnGuard.app path>");
}

const port = await findPort(14220);
const profile = await mkdtemp(path.join(tmpdir(), "burnguard-native-mac-"));
const reportPath = path.join(profile, "native-smoke.json");
const before = await processSnapshot();
const child = Bun.spawn(
  [
    path.join(appPath, "Contents/MacOS/BurnGuard"),
    "--smoke-test",
    "--smoke-report",
    reportPath,
  ],
  {
    env: {
      ...process.env,
      BG_APP_ROOT: profile,
      BG_PORT: String(port),
      BG_NO_OPEN: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  },
);

const [exitCode, stdout, stderr] = await Promise.all([
  child.exited,
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
]);
const report = JSON.parse(await readFile(reportPath, "utf8")) as NativeSmokeReport;
const after = await processSnapshot();
const launchedBrowsers = after.filter(
  (entry) =>
    !before.some((previous) => previous.pid === entry.pid) &&
    /Google Chrome\.app|\/Chromium|chrome_crashpad/i.test(entry.command),
);

try {
  if (exitCode !== 0) throw new Error(`native shell exited with ${exitCode}: ${stderr || stdout}`);
  if (!report.nativeWindowVisible || report.windowTitle !== "BurnGuard Design") {
    throw new Error(`native window was not visible: ${JSON.stringify(report)}`);
  }
  if (report.pageTitle !== "BurnGuard Design" || report.bodyTextLength < 40) {
    throw new Error(`native page did not load: ${JSON.stringify(report)}`);
  }
  if (launchedBrowsers.length > 0) {
    throw new Error(`external browser launched: ${JSON.stringify(launchedBrowsers)}`);
  }
  console.log(JSON.stringify({ report, launchedBrowsers, exitCode }));
} finally {
  await rm(profile, { recursive: true, force: true });
}

async function findPort(start: number): Promise<number> {
  for (let port = start; port < 65_536; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("No free QA port is available");
}

async function processSnapshot(): Promise<readonly ProcessEntry[]> {
  const child = Bun.spawn(["ps", "-axo", "pid=,command="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(child.stdout).text();
  await child.exited;
  return output
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      return match === null ? null : { pid: Number(match[1]), command: match[2] };
    })
    .filter((entry): entry is ProcessEntry => entry !== null);
}
