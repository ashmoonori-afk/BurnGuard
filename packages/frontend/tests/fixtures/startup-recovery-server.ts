import { mock } from "bun:test";
import { join } from "node:path";
import { CLAUDE_MODELS } from "@bg/shared";
import type { AdapterRunInput, AdapterRunResult } from "../../../backend/src/adapters/types";
import * as registry from "../../../backend/src/adapters/registry";
import * as backends from "../../../backend/src/services/backends";
import * as checkpoints from "../../../backend/src/services/checkpoints";
import * as lucideReference from "../../../backend/src/harness/lucide-reference";
import * as promptBuilder from "../../../backend/src/harness/prompt-builder";
import { getSqlite } from "../../../backend/src/db/sqlite-client";
import { insertNormalizedEvent } from "../../../backend/src/db/events";
import { reconcileArtifactState } from "../../../backend/src/services/artifact-recovery";
import { sequencedBroker } from "../../../backend/src/services/broker";
import { closeActiveExportBrowsers } from "../../../backend/src/services/export-browser-registry";

export type RecoveryServerMessage =
  | { readonly kind: "ready"; readonly origin: string; readonly recovered: number }
  | { readonly kind: "terminal"; readonly stopReason: string };

const appRoot = process.env.BG_APP_ROOT;
const sessionId = process.env.F09_SESSION;
const capability = process.env.F09_CAPABILITY;
const secret = process.env.F09_SECRET;
const generation = process.env.F09_GENERATION;
if (!appRoot || !sessionId || !capability || !secret || !generation) throw new Error("Missing isolated recovery fixture configuration");
const send = (message: RecoveryServerMessage) => process.send?.(message);
const started = performance.now();
let phaseCount = 0;
const mark = (phase: string, values: Record<string, string | number | boolean> = {}) => {
  if (phaseCount++ >= 48) {
    if (phaseCount === 49) process.stderr.write('F09_FIXTURE_PHASE {"phase":"truncated"}\n');
    return;
  }
  process.stderr.write(`F09_FIXTURE_PHASE ${JSON.stringify({ phase, ms: Math.round(performance.now() - started), ...values })}\n`);
};
mark("started");

// Capture originals before module replacement so the observations call real implementations.
const writePreTurnSnapshot = checkpoints.writePreTurnSnapshot;
const provisionLucideIconReference = lucideReference.provisionLucideIconReference;
const buildPrompt = promptBuilder.buildPrompt;
mock.module("../../../backend/src/services/checkpoints", () => ({
  ...checkpoints,
  async writePreTurnSnapshot(...args: Parameters<typeof writePreTurnSnapshot>) {
    mark("snapshot-enter");
    const result = await writePreTurnSnapshot(...args);
    mark("snapshot-complete");
    return result;
  },
}));
mock.module("../../../backend/src/harness/lucide-reference", () => ({
  ...lucideReference,
  async provisionLucideIconReference(...args: Parameters<typeof provisionLucideIconReference>) {
    mark("lucide-enter");
    const result = await provisionLucideIconReference(...args);
    mark("lucide-complete");
    return result;
  },
}));
mock.module("../../../backend/src/harness/prompt-builder", () => ({
  ...promptBuilder,
  async buildPrompt(...args: Parameters<typeof buildPrompt>) {
    mark("prompt-enter");
    const result = await buildPrompt(...args);
    mark("prompt-complete");
    return result;
  },
}));

// Only the external provider boundary is replaced. Routes, turn callbacks, validation,
// publication, recovery, durable replay and request authority are the production implementations.
mock.module("../../../backend/src/services/backends", () => ({
  ...backends,
  detectBackends: async () => {
    mark("discovery-enter");
    const result = { backends: [{ id: "claude-code", found: true, binary_path: "fixture-provider", models: CLAUDE_MODELS }] };
    mark("discovery-exit");
    return result;
  },
}));
mock.module("../../../backend/src/adapters/registry", () => ({
  ...registry,
  async runAdapterTurn(_backend: string, input: AdapterRunInput): Promise<AdapterRunResult> {
    mark("provider-entered");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Recovery fixture</title><style>body{margin:0;padding:48px;color:#111;background:#fff;font:20px/1.6 system-ui}main{max-width:720px}h1{font-size:36px}</style></head><body><main data-recovery-result="${generation}"><h1>Recovery fixture</h1><p>Saved output from generation ${generation}.</p></main></body></html>`;
    await Bun.write(join(input.projectDir, "index.html"), html);
    mark("provider-written");
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "chat.delta", turnId: input.turnId, text: `Generation ${generation} output` });
    mark("delta-forwarded");
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "chat.message_end", turnId: input.turnId });
    mark("message-end-buffered");
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "status.idle", stopReason: "end_turn" });
    mark("provider-idle-buffered");
    return { exitCode: 0 };
  },
}));

const { createApp } = await import("../../../backend/src/server");
const { interruptAllUserTurns } = await import("../../../backend/src/services/turns");
const recovered = await reconcileArtifactState(getSqlite());
mark("reconciled", { recovered: recovered.sessions });
const unsubscribe = sequencedBroker.subscribe(sessionId, ({ event }) => {
  mark("broker", { type: event.type });
  // This synchronous notification follows the real SQLite commit and baseline publication,
  // but precedes the turn's buffered success terminal. SIGKILL cannot run graceful cleanup.
  if (generation === "first" && event.type === "artifact.operation" && event.outcome === "committed") process.kill(process.pid, "SIGKILL");
  if (event.type === "status.idle") {
    mark("terminal-send-before");
    send({ kind: "terminal", stopReason: event.stopReason });
    mark("terminal-send-after");
  }
});
let app: ReturnType<typeof createApp>;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  // Match the production server's lifetime for quiet SSE connections.
  idleTimeout: 255,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/fixture.js") return new Response(Bun.file(join(appRoot, "f09-fixture.js")), { headers: { "content-type": "text/javascript; charset=utf-8" } });
    if (pathname === "/fixture.css") return new Response(Bun.file(join(appRoot, "f09-fixture.css")), { headers: { "content-type": "text/css; charset=utf-8" } });
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/runtime/")) return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root" class="flex h-dvh flex-col"></div><script src="/fixture.js"></script></body></html>', { headers: { "content-type": "text/html; charset=utf-8" } });
    if (request.method === "POST") mark("post-enter");
    const response = await app.fetch(request);
    if (request.method !== "GET" || response.status >= 400 || pathname.endsWith("/stream")) {
      mark("response", { method: request.method, status: response.status, stream: pathname.endsWith("/stream") });
    }
    if (pathname.endsWith("/stream") && response.status === 200) {
      mark("stream-flush-before");
      // Flush the real SSE connection without waiting for its heartbeat.
      const envelope = await insertNormalizedEvent(sessionId, { id: crypto.randomUUID(), ts: Date.now(), type: "usage.delta", input: 0, output: 0 });
      sequencedBroker.publish(sessionId, envelope);
      mark("stream-flush-after");
    }
    return response;
  },
});
app = createApp({ capability, bootstrapSecret: secret, appAuthority: server.url.host });
process.on("message", (command: unknown) => {
  if (command !== "stop") return;
  void (async () => {
    mark("cleanup-before-turns");
    await interruptAllUserTurns();
    mark("cleanup-after-turns");
    await closeActiveExportBrowsers();
    unsubscribe();
    await server.stop(true);
    getSqlite().close();
    process.exit(0);
  })();
});
send({ kind: "ready", origin: server.url.origin, recovered: recovered.sessions });
