import { join } from "node:path";
import { createApp } from "../../../backend/src/server";
import { insertNormalizedEvent } from "../../../backend/src/db/events";
import { sequencedBroker } from "../../../backend/src/services/broker";

export type AuthorityServerMessage =
  | { kind: "ready"; origin: string; pid: number }
  | { kind: "request"; method: string; path: string; status: number }
  | { kind: "holding" | "snapshot-held" | "released" };

const send = (message: AuthorityServerMessage) => process.send?.(message);
const appRoot = process.env.BG_APP_ROOT;
const capability = process.env.F08_CAPABILITY;
const secret = process.env.F08_SECRET;
if (!appRoot || !capability || !secret) throw new Error("Missing isolated authority server configuration");
let app: ReturnType<typeof createApp>;
let heldSnapshot: ReturnType<typeof Promise.withResolvers<void>> | null = null;
const server = Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.F08_PORT ?? 0),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") return new Response(Bun.file(join(appRoot, "f08-fixture.js")), { headers: { "content-type": "text/javascript" } });
    if (path === "/fixture.css") return new Response(Bun.file(join(appRoot, "f08-fixture.css")), { headers: { "content-type": "text/css" } });
    if (!path.startsWith("/api/")) return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root" class="flex h-dvh flex-col"></div><script src="/fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    const response = await app.fetch(request);
    send({ kind: "request", method: request.method, path, status: response.status });
    if (path.endsWith("/snapshot") && heldSnapshot) {
      send({ kind: "snapshot-held" });
      await heldSnapshot.promise;
    }
    if (path.endsWith("/stream") && response.status === 200) {
      // Flush a real durable event instead of waiting for the 30-second heartbeat.
      const encodedId = path.split("/")[3];
      if (!encodedId) throw new Error("Missing authority fixture session identifier");
      const id = decodeURIComponent(encodedId);
      const envelope = await insertNormalizedEvent(id, { id: crypto.randomUUID(), ts: Date.now(), type: "usage.delta", input: 0, output: 0 });
      sequencedBroker.publish(id, envelope);
    }
    return response;
  },
});
app = createApp({
  capability,
  bootstrapSecret: secret,
  appAuthority: server.url.host,
});
process.on("message", (command: unknown) => {
  if (command === "hold-snapshot") { heldSnapshot = Promise.withResolvers<void>(); send({ kind: "holding" }); }
  if (command === "release-snapshot") { heldSnapshot?.resolve(); heldSnapshot = null; send({ kind: "released" }); }
  if (command === "stop") {
    heldSnapshot?.resolve();
    void server.stop(true).then(() => process.exit(0));
  }
});
send({ kind: "ready", origin: server.url.origin, pid: process.pid });
