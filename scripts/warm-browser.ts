#!/usr/bin/env bun
/**
 * Warms the browser a host launches, for CI: the first launch and the first page of a system Chrome on a fresh
 * runner are cold starts (3-25 s measured, over 45 s once) that must not be paid inside a test's deadline.
 * Step 1 runs the Node bridge probe with a long budget per channel and prints each channel's result and time.
 * Step 2 renders one page through the product's own measurement path until it succeeds.
 * Exits non-zero when no browser starts or no render completes.
 */
import { chromiumNodeCommand } from "../packages/backend/src/services/chromium-node-launch";
import { measureRenderedLayout } from "../packages/backend/src/services/extraction-rendered-layout";

const PROBE_CHANNEL_BUDGET_MS = 180_000;
const PROBE_BUDGET_MS = 3 * PROBE_CHANNEL_BUDGET_MS + 30_000;
const RENDER_ATTEMPTS = 4;
const RENDER_BUDGET_MS = 120_000;

const node = chromiumNodeCommand();
if (node === null) { console.error("warm-browser: no Node runtime for the Chromium bridge"); process.exit(1); }

const probeStarted = Date.now();
const probe = Bun.spawn({ cmd: [node.node, node.script, "--probe"], cwd: node.cwd, env: { ...process.env, BG_CHROMIUM_PROBE_CHANNEL_TIMEOUT_MS: String(PROBE_CHANNEL_BUDGET_MS) }, stdin: "ignore", stdout: "ignore", stderr: "inherit" });
const probeDeadline = setTimeout(() => { probe.kill(); }, PROBE_BUDGET_MS);
const probeExit = await probe.exited;
clearTimeout(probeDeadline);
console.log(`warm-browser: probe exit ${probeExit} after ${Date.now() - probeStarted} ms`);
if (probeExit !== 0) process.exit(1);

const html = '<!doctype html><html><head><link rel="stylesheet" href="https://site.test/site.css"></head><body><main><h1>Warm</h1><p class="sub">The first page of a cold browser is rendered here.</p></main></body></html>';
for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt += 1) {
  const started = Date.now();
  let failure = "";
  const layout = await measureRenderedLayout({
    pages: [{ path: "/", pageType: "home", url: "https://site.test/", html }],
    stylesheets: new Map([["https://site.test/site.css", "body{margin:0} h1{font-size:64px}"]]),
    signal: AbortSignal.timeout(RENDER_BUDGET_MS),
    captureReference: () => undefined,
    reportFailure: (reported) => { failure = `${reported.stage}/${reported.code}`; },
  }).catch(() => null);
  console.log(`warm-browser: render attempt ${attempt} ${layout === null ? `failed (${failure || "aborted"})` : "ok"} after ${Date.now() - started} ms`);
  if (layout !== null) process.exit(0);
}
process.exit(1);
