import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  readonly projectId: string;
  readonly baseRevision: number;
  readonly savedRevision: number;
  readonly reloadPersisted: boolean;
  readonly reloadedRevision: number;
  readonly exports: Readonly<Record<"svg" | "pdf", { readonly id: string; readonly size: number; readonly digest: string }>>;
  readonly downloads: readonly string[];
  readonly downloadCompleted: boolean;
  readonly snapshotCaptured: boolean;
}

interface FixtureReceipt {
  readonly projectId: string;
  readonly projectRelPath: string;
  readonly editBaseline: string;
  readonly editPersisted: string;
  readonly setup: string;
}

interface ProcessEntry {
  readonly pid: number;
  readonly command: string;
}

const appArgument = process.argv[2];
const evidenceDirectory = process.argv[3];
if (appArgument === undefined || process.platform !== "darwin") {
  throw new Error("Usage on macOS: bun scripts/qa/native-mac-smoke.ts <BurnGuard.app path> [evidence directory]");
}

const root = path.resolve(import.meta.dir, "../..");
const appPath = await realpath(appArgument);
const port = await findPort(14220);
const profile = await mkdtemp(path.join(tmpdir(), "burnguard-native-mac-"));
const reportPath = path.join(profile, "native-smoke.json");
const fixturePath = path.join(profile, "native-smoke-fixture.json");
let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  const fixture = await seedFixture(profile);
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  const before = await processSnapshot();
  child = Bun.spawn([
    path.join(appPath, "Contents/MacOS/BurnGuard"),
    "--smoke-test", "--smoke-report", reportPath,
    "--smoke-project", fixture.projectId,
  ], {
    env: { ...process.env, BG_APP_ROOT: profile, BG_PORT: String(port), BG_NO_OPEN: "1" },
    detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timeout = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error("Native smoke exceeded its 400-second deadline")), 400_000);
  });
  const [exitCode, stdout, stderr] = await Promise.race([
    Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]), timeout,
  ]);
  const report = JSON.parse(await readFile(reportPath, "utf8")) as NativeSmokeReport;
  const after = await processSnapshot();
  const launchedBrowsers = after.filter(entry => !before.some(previous => previous.pid === entry.pid)
    && /Google Chrome\.app|\/Chromium|chrome_crashpad|Safari\.app\/Contents\/MacOS\/Safari/i.test(entry.command));

  assert.equal(exitCode, 0, `Native shell must exit successfully: ${stderr}`);
  assert.equal(report.nativeWindowVisible, true, "Native window must be visible");
  assert.equal(report.windowTitle, "BurnGuard Design");
  assert.equal(report.pageTitle, "BurnGuard Design");
  assert.ok(report.bodyTextLength >= 40);
  assert.equal(report.canvasReady, true, "The real project canvas must finish loading");
  assert.equal(report.projectId, fixture.projectId);
  assert.equal(report.savedRevision, report.baseRevision + 1, "UI save must advance one durable revision");
  assert.equal(report.reloadPersisted, true, "Reloaded canvas must expose the saved text through the edit UI");
  assert.equal(report.reloadedRevision, report.savedRevision);
  assert.equal(report.downloadCompleted, true, "Both real export downloads must finish in WKDownload");
  assert.equal(report.downloads.length, 2);
  assert.equal(report.snapshotCaptured, true);
  assert.equal(launchedBrowsers.length, 0, "Native smoke must not launch Chrome, Chromium, or Safari");
  assert.ok(report.backendPid > 0 && !after.some(entry => entry.pid === report.backendPid), "Owned backend must exit before profile cleanup");

  assert.ok(fixture.projectRelPath !== "" && !path.isAbsolute(fixture.projectRelPath) && !fixture.projectRelPath.split(path.sep).includes(".."));
  const projectHtml = await readFile(path.join(profile, fixture.projectRelPath, "index.html"), "utf8");
  assert.ok(projectHtml.includes(fixture.editPersisted), "Persisted project bytes must contain the UI edit");
  assert.ok(!projectHtml.includes(fixture.editBaseline), "Persisted project bytes must not retain the baseline text");

  const names = await readdir(profile);
  const svgName = names.find(name => name.endsWith(".svg"));
  const pdfName = names.find(name => name.endsWith(".pdf"));
  assert.ok(svgName, "WKDownload must produce an SVG file");
  assert.ok(pdfName, "WKDownload must produce a PDF file");
  const svg = await readFile(path.join(profile, svgName));
  const pdf = await readFile(path.join(profile, pdfName));
  assert.ok(svg.byteLength > 100 && svg.toString("utf8").startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""));
  assert.equal(digest(svg), report.exports.svg.digest, "Downloaded SVG must match the completed export digest");
  assert.ok(pdf.byteLength > 1_000 && pdf.subarray(0, 5).toString("ascii") === "%PDF-");
  assert.equal(digest(pdf), report.exports.pdf.digest, "Downloaded PDF must match the completed export digest");
  assert.equal(pdfPageCount(pdf), 8, "Guidelines PDF must contain all eight real artboards");

  const summary = {
    report,
    fixture: { projectId: fixture.projectId, setup: fixture.setup },
    downloads: [
      { format: "svg", filename: svgName, bytes: svg.byteLength, sha256: digest(svg) },
      { format: "pdf", filename: pdfName, bytes: pdf.byteLength, sha256: digest(pdf), pages: 8 },
    ],
    launchedBrowsers,
    exitCode,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
  };
  console.log(JSON.stringify(summary));
  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(path.join(evidenceDirectory, "native-smoke-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
} finally {
  clearTimeout(deadline);
  try {
    if (child) await stopChild(child);
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      for (const name of await readdir(profile)) {
        if (name === "native-smoke.json" || name === "native-smoke.json.png" || name === "native-smoke-fixture.json" || name.endsWith(".svg") || name.endsWith(".pdf")) {
          await copyFile(path.join(profile, name), path.join(evidenceDirectory, name));
        }
      }
    }
  } finally { await rm(profile, { recursive: true, force: true }); }
}

async function seedFixture(ownedProfile: string): Promise<FixtureReceipt> {
  const processHandle = Bun.spawn(["bun", path.join(root, "scripts/qa/fixtures/native-mac-logo.ts"), ownedProfile], {
    cwd: root,
    env: { ...process.env, BG_APP_ROOT: ownedProfile },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  assert.equal(exitCode, 0, `Native fixture seed failed: ${stderr}`);
  const line = stdout.trim().split("\n").at(-1);
  assert.ok(line, "Native fixture seed returned no receipt");
  return JSON.parse(line) as FixtureReceipt;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pdfPageCount(bytes: Uint8Array): number {
  return (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
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
