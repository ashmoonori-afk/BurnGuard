#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const modulePath = args.get("--module");
if (!modulePath) throw new Error("--module is required");
const port = Number(args.get("--port") ?? 14200);
const base = `http://127.0.0.1:${port}`;
const evidence = path.resolve(args.get("--evidence") ?? "/tmp/burnguard-full-feature");
const { chromium } = await import(pathToFileURL(path.join(root, "packages/backend/node_modules/playwright-core/index.mjs")).href);
const temporaryParent = await realpath(tmpdir());
const home = await mkdtemp(path.join(temporaryParent, "burnguard-e2e-home-"));
const results = [];
let backend;
let browser;
let page;
let backendLog = "";

async function deadline(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function shot(name) {
  const filename = path.join(evidence, `${name.replace(/[^a-zA-Z0-9_-]/g, "-")}.png`);
  await page.screenshot({ path: filename, animations: "disabled" });
  return filename;
}

async function check(name, action, mode = "live-local") {
  const started = Date.now();
  try {
    const observation = await deadline(Promise.resolve().then(action), 300_000, `${name} timed out`);
    const screenshot = await shot(name);
    results.push({ name, mode, ok: true, milliseconds: Date.now() - started, observation: observation ?? null, screenshot });
  } catch (error) {
    results.push({ name, mode, ok: false, milliseconds: Date.now() - started, error: String(error.stack ?? error), screenshot: await shot(`fail-${name}`) });
    throw error;
  } finally {
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(path.join(evidence, "results.json"), JSON.stringify(results, null, 2));
  }
}

try {
  await mkdir(evidence, { recursive: true });
  if (args.get("--live-auth") !== "yes") {
    await mkdir(path.join(home, ".codex"));
    await mkdir(path.join(home, ".claude"));
  }
  console.log(JSON.stringify({ resource: "isolated-profile", home, port, module: modulePath }));
  backend = spawn("bun", ["run", "src/index.ts"], {
    cwd: path.join(root, "packages/backend"),
    env: { ...process.env, BG_APP_ROOT: path.join(home, ".burnguard"), BG_PORT: String(port), BG_NO_OPEN: "1",
      ...(args.get("--live-auth") === "yes" ? {} : { CODEX_HOME: path.join(home, ".codex"), CLAUDE_CONFIG_DIR: path.join(home, ".claude") }) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await deadline(new Promise((resolve, reject) => {
    backend.once("error", reject);
    backend.once("exit", (code) => reject(new Error(`Backend exited before readiness: ${code}`)));
    const receive = (chunk) => {
      backendLog += chunk;
      if (backendLog.includes(`[burnguard] listening on ${base}`)) resolve();
    };
    backend.stdout.on("data", receive);
    backend.stderr.on("data", receive);
  }), 180_000, "Backend readiness timed out");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const feature = await import(pathToFileURL(path.resolve(root, modulePath)).href);
  await feature.run({ page, context, base, home, check, shot, evidence });
  if (results.length === 0) throw new Error("No feature scenarios executed");
} catch (error) {
  console.error(error);
  if (results.length === 0 || results.at(-1).ok) results.push({ name: "harness", mode: "harness", ok: false, error: String(error.stack ?? error) });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (backend && backend.exitCode === null) {
    const exited = once(backend, "exit");
    backend.kill("SIGTERM");
    try { await deadline(exited, 15_000, "Backend cleanup timed out"); }
    catch (error) { backend.kill("SIGKILL"); await exited; console.error(error); process.exitCode = 1; }
  }
  const owned = await realpath(home);
  let removedProfile = null;
  if (path.dirname(owned) !== temporaryParent || !path.basename(owned).startsWith("burnguard-e2e-home-")) {
    console.error("Refusing unowned profile cleanup");
    process.exitCode = 1;
  } else {
    await rm(owned, { recursive: true, force: true });
    removedProfile = owned;
  }
  await writeFile(path.join(evidence, "results.json"), JSON.stringify(results, null, 2));
  await writeFile(path.join(evidence, "backend.log"), backendLog);
  await writeFile(path.join(evidence, "cleanup.json"), JSON.stringify({ browserClosed: true, backendStopped: true, removedProfile }, null, 2));
  console.log(JSON.stringify({ complete: true, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, evidence, cleanup: removedProfile ? "complete" : "failed" }));
}
