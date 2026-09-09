#!/usr/bin/env node
// Run after bun run build. This exercises a relocated portable build with no Node/Bun on PATH.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (process.platform !== "win32") throw new Error("This smoke requires the Windows portable build");
const parent = await realpath(tmpdir());
const fixture = await mkdtemp(path.join(parent, "burnguard-package-"));
const app = path.join(fixture, "한글 portable app");
const profile = path.join(fixture, "profile");
const base = "http://127.0.0.1:14174";
let backend;
let probe;
let log = "";
const checks = [];
try {
  await cp(path.join(repo, "dist/windows"), app, { recursive: true });
  await mkdir(profile);
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"), BG_APP_ROOT: profile, BG_PORT: "14174", BG_NO_OPEN: "1" };
  backend = spawn(path.join(app, "burnguard-design.exe"), [], { cwd: fixture, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  await bounded(new Promise((resolve, reject) => {
    backend.once("error", reject);
    backend.once("exit", () => reject(new Error("portable backend exited before ready")));
    backend.stderr.on("data", (chunk) => { log += chunk; });
    backend.stdout.on("data", (chunk) => { log += chunk; if (log.includes(`[burnguard] listening on ${base}`)) resolve(); });
  }), 90_000);
  const request = (url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(30_000) });
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).name, "BurnGuard Design");
  checks.push("relocated-executable-health");
  assert.equal((await request("/api/projects")).status, 403);
  const bootstrap = await request("/api/bootstrap", { headers: { Origin: base } });
  assert.equal(bootstrap.status, 200);
  const { data: authority } = await bootstrap.json();
  const headers = { Origin: base, "X-Burnguard-Capability": authority.capability };
  const projects = await (await request("/api/projects", { headers })).json();
  assert.ok(projects.data.length > 0);
  const systems = await (await request("/api/design-systems", { headers })).json();
  assert.ok(systems.data.length > 0);
  assert.ok((await readFile(path.join(profile, "burnguard.db"))).length > 0);
  checks.push("fresh-migrations-and-seeded-systems");
  const ui = await request("/");
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /<div id="root"/);
  const mark = await request("/assets/burnguard-mark.png");
  assert.equal(mark.status, 200);
  assert.match(mark.headers.get("content-type"), /image\/png/);
  assert.deepEqual(Buffer.from(await mark.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const runtime = await request("/runtime/deck-stage.js");
  assert.match(runtime.headers.get("content-type"), /javascript/);
  assert.doesNotMatch(await runtime.text(), /<!doctype html>/i);
  checks.push("portable-ui-and-javascript-runtime");
  const resources = path.join(app, "resources");
  const threeRuntime = await readFile(path.join(resources, ".burnguard-three/runtime.js"), "utf8");
  const threeLicense = await readFile(path.join(resources, ".burnguard-three/LICENSE"), "utf8");
  assert.ok(threeRuntime.length > 10_000, "portable resources must contain the bundled Three runtime");
  assert.match(threeLicense, /MIT License|Permission is hereby granted/);
  checks.push("portable-three-runtime-and-license");
  const mineResponse = await request("/api/projects?tab=mine&limit=100", { headers });
  assert.equal(mineResponse.status, 200);
  const { data: mine } = await mineResponse.json();
  const project = mine.find((candidate) => candidate.name === "Portfolio Playground");
  assert.ok(project, "fresh owned profile must have the HTML playground fixture");
  assert.match(project.id, /^[a-zA-Z0-9_-]+$/);
  const sceneUrl = `/api/projects/${project.id}/three-scene?path=index.html`;
  const sceneResponse = await request(sceneUrl, { headers });
  assert.equal(sceneResponse.status, 200);
  const { data: before } = await sceneResponse.json();
  assert.equal(before.scene, null);
  const scene = { schema_version: 1, background: "#eef2f6", objects: [] };
  const saved = await request(sceneUrl, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ scene, expected_revision: before.revision, expected_artifact_digest: before.artifact_digest, expected_file_hash: before.file_hash }) });
  assert.equal(saved.status, 200, "portable scene save must use bundled assets without source-tree or PATH runtimes");
  const { data: operation } = await saved.json();
  assert.equal(operation.result_revision, before.revision + 1);
  const afterResponse = await request(sceneUrl, { headers });
  assert.equal(afterResponse.status, 200);
  const { data: after } = await afterResponse.json();
  assert.deepEqual(after.scene, scene);
  assert.equal(after.revision, operation.result_revision);
  assert.notEqual(after.file_hash, before.file_hash);
  const htmlResponse = await request(`/api/projects/${project.id}/fs/index.html`, { headers });
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  const config = html.match(/<script type="application\/json" data-bg-three-config>([^<]+)<\/script>/);
  assert.ok(config, "saved HTML must carry a typed scene configuration");
  assert.deepEqual(JSON.parse(config[1]), scene);
  assert.ok(html.includes(`<script data-bg-three-runtime>${threeRuntime.replace(/<\/script/gi, "<\\/script")}</script>`), "saved HTML must inline the relocated bundled runtime");
  assert.equal(await readFile(path.join(profile, "data/projects", project.id, ".burnguard-three/LICENSE"), "utf8"), threeLicense);
  checks.push("portable-three-scene-save-and-inline-runtime-without-path-runtime");
  const marker = JSON.parse(await readFile(path.join(resources, "burnguard-runtime.json"), "utf8"));
  assert.match(marker.nodeVersion, /^v\d+\.\d+\.\d+$/);
  assert.match(await readFile(path.join(resources, "node/LICENSE"), "utf8"), /Node\.js/);
  assert.ok((await readFile(path.join(resources, "extraction-css-worker.js"))).length > 0);
  probe = spawn(path.join(resources, "node/node.exe"), [path.join(resources, "chromium-node-bridge.mjs"), "--probe"], { cwd: fixture, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  probe.stdout.on("data", (chunk) => { output += chunk; });
  probe.stderr.resume();
  const [code] = await bounded(once(probe, "exit"), 60_000);
  assert.equal(code, 0);
  assert.match(output, /usable/);
  checks.push("bundled-node-browser-probe-without-path-runtime");
  console.log(JSON.stringify({ ok: true, checks, nodeVersion: marker.nodeVersion }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, checks, error: String(error.message), startupReached: log.includes("listening on") }));
  process.exitCode = 1;
} finally {
  await stopOwnedChild(probe);
  await stopOwnedChild(backend);
  const owned = await realpath(fixture);
  assert.equal(path.dirname(owned), parent);
  assert.ok(path.basename(owned).startsWith("burnguard-package-"));
  await rm(owned, { recursive: true, force: true });
}

async function stopOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const stopped = once(child, "exit");
  const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await bounded(once(killer, "exit"), 15_000, () => killer.kill());
  await bounded(stopped, 15_000);
}

async function bounded(promise, timeoutMs, onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(new Error("package smoke deadline")); }, timeoutMs); })]);
  } finally { clearTimeout(timer); }
}
