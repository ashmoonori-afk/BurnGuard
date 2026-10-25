import { mock } from "bun:test";
import { join } from "node:path";
import { CLAUDE_MODELS } from "@bg/shared";
import type { AdapterRunInput, AdapterRunResult } from "../../../backend/src/adapters/types";
import * as registry from "../../../backend/src/adapters/registry";
import * as backends from "../../../backend/src/services/backends";
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

// Only the external provider boundary is replaced. Routes, turn callbacks, validation,
// publication, recovery, durable replay and request authority are the production implementations.
mock.module("../../../backend/src/services/backends", () => ({
  ...backends,
  detectBackends: async () => ({ backends: [{ id: "claude-code", found: true, binary_path: "fixture-provider", models: CLAUDE_MODELS }] }),
}));
mock.module("../../../backend/src/adapters/registry", () => ({
  ...registry,
  async runAdapterTurn(_backend: string, input: AdapterRunInput): Promise<AdapterRunResult> {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Recovery fixture</title><style>body{margin:0;padding:48px;color:#111;background:#fff;font:20px/1.6 system-ui}main{max-width:720px}h1{font-size:36px}</style></head><body><main data-recovery-result="${generation}"><h1>Recovery fixture</h1><p>Saved output from generation ${generation}.</p></main></body></html>`;
    await Bun.write(join(input.projectDir, "index.html"), html);
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "chat.delta", turnId: input.turnId, text: `Generation ${generation} output` });
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "chat.message_end", turnId: input.turnId });
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "status.idle", stopReason: "end_turn" });
    return { exitCode: 0 };
  },
}));

const { createApp } = await import("../../../backend/src/server");
const { interruptAllUserTurns } = await import("../../../backend/src/services/turns");
const recovered = await reconcileArtifactState(getSqlite());
const unsubscribe = sequencedBroker.subscribe(sessionId, ({ event }) => {
  // This synchronous notification follows the real SQLite commit and baseline publication,
  // but precedes the turn's buffered success terminal. SIGKILL cannot run graceful cleanup.
  if (generation === "first" && event.type === "artifact.operation" && event.outcome === "committed") process.kill(process.pid, "SIGKILL");
  if (event.type === "status.idle") send({ kind: "terminal", stopReason: event.stopReason });
});
let app: ReturnType<typeof createApp>;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/fixture.js") return new Response(Bun.file(join(appRoot, "f09-fixture.js")), { headers: { "content-type": "text/javascript; charset=utf-8" } });
    if (pathname === "/fixture.css") return new Response(Bun.file(join(appRoot, "f09-fixture.css")), { headers: { "content-type": "text/css; charset=utf-8" } });
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/runtime/")) return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root" class="flex h-dvh flex-col"></div><script src="/fixture.js"></script></body></html>', { headers: { "content-type": "text/html; charset=utf-8" } });
    const response = await app.fetch(request);
    if (pathname.endsWith("/stream") && response.status === 200) {
      // Flush the real SSE connection without waiting for its heartbeat.
      const envelope = await insertNormalizedEvent(sessionId, { id: crypto.randomUUID(), ts: Date.now(), type: "usage.delta", input: 0, output: 0 });
      sequencedBroker.publish(sessionId, envelope);
    }
    return response;
  },
});
app = createApp({ capability, bootstrapSecret: secret, appAuthority: server.url.host });
process.on("message", (command: unknown) => {
  if (command !== "stop") return;
  void (async () => {
    await interruptAllUserTurns();
    await closeActiveExportBrowsers();
    unsubscribe();
    await server.stop(true);
    getSqlite().close();
    process.exit(0);
  })();
});
send({ kind: "ready", origin: server.url.origin, recovered: recovered.sessions });
