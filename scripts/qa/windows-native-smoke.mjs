#!/usr/bin/env node
// Real WebView2 window, isolated profile; no generation requests or user-data mutations.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const release = process.argv[2] === "--release";
if (process.argv.length > (release ? 3 : 2)) throw new Error("Usage: node scripts/qa/windows-native-smoke.mjs [--release]");
if (process.platform !== "win32") throw new Error("Windows and the WebView2 Runtime are required.");
const parent = await realpath(tmpdir());
const fixture = await mkdtemp(path.join(parent, "burnguard-native-"));
const app = path.join(fixture, "한글 native app");
const profile = path.join(fixture, "profile");
const evidence = path.join(repo, ".omo/evidence/windows-native-2026-09-09");
const port = 14175;
const checks = [];
let child;
let guard;
let receipt;
const env = { ...process.env, BG_APP_ROOT: profile, BG_PORT: String(port), BG_NO_OPEN: "1" };
try {
  await mkdir(evidence, { recursive: true });
  if (release) {
    await mkdir(app);
    const extract = spawn("tar.exe", ["-xf", path.join(repo, "dist/releases/BurnGuard-win-Portable.zip"), "-C", app], { windowsHide: true, stdio: "ignore" });
    assert.equal((await bounded(once(extract, "exit"), 90_000))[0], 0, "release ZIP extraction must succeed");
    const version = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")).version;
    assert.ok((await readFile(path.join(app, "current/sq.version"), "utf8")).includes(`<version>${version}</version>`));
    checks.push("velopack-portable-layout");
  } else await cp(path.join(repo, "dist/windows-native"), app, { recursive: true });
  await mkdir(profile);
  const report = path.join(fixture, "smoke.json");
  guard = createServer();
  guard.listen(port, "127.0.0.1");
  await once(guard, "listening");
  assert.equal(await run(report), 1, "an occupied port must refuse startup");
  assert.equal(JSON.parse(await readFile(report, "utf8")).ok, false);
  await assert.rejects(readFile(path.join(profile, "burnguard.db")), { code: "ENOENT" });
  checks.push("port-collision-refuses-before-profile-mutation");
  await new Promise((resolve) => guard.close(resolve));
  guard = null;

  await rm(report, { force: true });
  const nativeExit = await run(report);
  receipt = JSON.parse(await readFile(report, "utf8"));
  assert.equal(nativeExit, 0, "real native smoke must exit successfully");
  assert.equal(receipt.ok, true);
  assert.equal(receipt.dom.origin, `http://127.0.0.1:${port}`);
  assert.equal(receipt.dom.modelSelected, true);
  assert.ok(receipt.dom.modelOptions > 1);
  assert.ok((await readFile(path.join(profile, "burnguard.db"))).length > 0);
  checks.push("relocated-native-window-webview2-react-model-selection");
  assert.throws(() => process.kill(receipt.servicePid, 0), { code: "ESRCH" }, "owned service must exit with the native window");
  guard = createServer();
  guard.listen(port, "127.0.0.1");
  await once(guard, "listening");
  checks.push("window-close-stops-owned-service-and-releases-port");
  await cp(receipt.screenshot, path.join(evidence, "native-window.png"));
  const result = { ok: true, release, checks, startupElapsedMs: receipt.startupElapsedMs, webViewVersion: receipt.webViewVersion, dom: receipt.dom };
  await writeFile(path.join(evidence, release ? "release-native-smoke.json" : "native-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ ok: false, checks, error: error.message, native: receipt }));
  process.exitCode = 1;
} finally {
  if (guard?.listening) await new Promise((resolve) => guard.close(resolve));
  if (child?.exitCode === null) {
    const exited = once(child, "exit");
    child.kill(); // The native Windows job owns cleanup of its service children.
    await bounded(exited, 15_000);
  }
  const owned = await realpath(fixture);
  assert.equal(path.dirname(owned), parent);
  assert.ok(path.basename(owned).startsWith("burnguard-native-"));
  await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

async function run(report) {
  child = spawn(path.join(app, release ? "current/BurnGuard.exe" : "BurnGuard.exe"), ["--smoke-test", "--smoke-report", report], { cwd: fixture, env, windowsHide: false, stdio: "ignore" });
  const [code] = await bounded(once(child, "exit"), 180_000);
  return code;
}

async function bounded(promise, timeoutMs) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("native smoke deadline")), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
