import { chromium } from "playwright-core";

const CHANNELS = [{}, { channel: "chrome" }, { channel: "msedge" }];
const LAUNCH_TIMEOUT_MS = 20_000;
/** A cold first launch of system Chrome took 15 s and 25 s on two of ten fresh Windows CI runners; the caller stops the whole probe at 45 s. */
const PROBE_CHANNEL_TIMEOUT_MS = 30_000;
const PROBE_CLOSE_TIMEOUT_MS = 5_000;
/** Exit code of a probe in which a channel ran out of time and none launched: no answer, not a missing browser. */
export const PROBE_INCONCLUSIVE_EXIT_CODE = 2;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * playwright-core 1.59.1 does not apply launchServer's `timeout` option (no deadline reaches its progress
 * controller), so a browser process that starts but never answers would hold this child forever. Every launch is
 * raced against a deadline here instead; a launch that is still pending when this process exits is killed by
 * Playwright's own exit handler.
 */
export async function launchWithin(launch, options, timeoutMs, deadline = wait) {
  const attempt = launch(options);
  const expired = Symbol("expired");
  const outcome = await Promise.race([
    attempt.then((server) => ({ kind: "launched", server }), () => ({ kind: "failed" })),
    deadline(timeoutMs).then(() => expired),
  ]);
  if (outcome !== expired) return outcome;
  void attempt.then((server) => server.close()).catch(() => undefined);
  return { kind: "timeout" };
}

/** Tries each channel in order under its own deadline, so one stuck browser cannot consume the whole probe. */
export async function probeChannels({ launch, timeoutMs = PROBE_CHANNEL_TIMEOUT_MS, closeTimeoutMs = PROBE_CLOSE_TIMEOUT_MS, deadline = wait, report = () => undefined }) {
  let timedOut = false;
  for (const options of CHANNELS) {
    const outcome = await launchWithin(launch, options, timeoutMs, deadline);
    report(options.channel ?? "bundled", outcome.kind);
    if (outcome.kind === "launched") {
      await Promise.race([outcome.server.close().catch(() => undefined), deadline(closeTimeoutMs)]);
      return "usable";
    }
    if (outcome.kind === "timeout") timedOut = true;
  }
  return timedOut ? "inconclusive" : "unusable";
}

function probeChannelTimeoutMs() {
  const override = Number(process.env.BG_CHROMIUM_PROBE_CHANNEL_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : PROBE_CHANNEL_TIMEOUT_MS;
}

async function probe() {
  const started = Date.now();
  const verdict = await probeChannels({
    launch: (options) => chromium.launchServer({ ...options, headless: true, host: "127.0.0.1" }),
    timeoutMs: probeChannelTimeoutMs(),
    report: (channel, kind) => { process.stderr.write(`chromium probe ${channel}: ${kind} at ${Date.now() - started}ms\n`); },
  });
  if (verdict === "usable") { process.stdout.write("usable", () => { process.exit(0); }); return; }
  process.exit(verdict === "inconclusive" ? PROBE_INCONCLUSIVE_EXIT_CODE : 1);
}

async function serve() {
  let server;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try { await server?.close(); } finally { process.exit(0); }
  };
  process.stdin.resume();
  process.stdin.once("end", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
  process.once("SIGINT", () => { void close(); });
  try {
    const options = JSON.parse(process.argv[2] ?? "{}");
    const outcome = await launchWithin((launchOptions) => chromium.launchServer(launchOptions), { headless: true, host: "127.0.0.1", ...(typeof options.channel === "string" ? { channel: options.channel } : {}) }, LAUNCH_TIMEOUT_MS);
    if (outcome.kind !== "launched") throw new Error("Chromium bridge launch failed");
    server = outcome.server;
    if (closing) { await server.close(); process.exit(0); }
    process.stdout.write(JSON.stringify({ endpoint: server.wsEndpoint() }) + "\n");
  } catch {
    process.stderr.write("Chromium bridge launch failed\n");
    process.exit(1);
  }
}

// Only an imported copy (the unit tests) reports false; an older Node without import.meta.main still runs.
if (import.meta.main !== false) await (process.argv[2] === "--probe" ? probe() : serve());
