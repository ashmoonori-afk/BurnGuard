import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright-core";
import { chromium } from "../../src/services/playwright-runtime";
import { createApp } from "../../src/server";
import { runMigrations } from "../../src/db/migrate-local";
import { getSqlite, closeSqlite } from "../../src/db/sqlite-client";
import { projectsDir } from "../../src/lib/paths";
import { ArtifactCoordinator } from "../../src/services/artifact-coordinator";
import { activeExportBrowserCount, closeActiveExportBrowsers } from "../../src/services/export-browser-registry";

// Hold the actual outgoing route command, not a mocked route promise. Cancellation
// must settle the protocol callback and Playwright's route handler without a reply.
type TestConnection = {
  onmessage: (message: { method: string }) => void;
  initializePlaywright: () => Promise<{ _initializer: { preLaunchedBrowser: { _object: Browser } } }>;
  _callbacks: Map<number, unknown>;
};
const prototype = (chromium as unknown as { _connection: { constructor: { prototype: TestConnection } } })._connection.constructor.prototype;
const initialize = prototype.initializePlaywright;
let held = false;
let snapshot: (() => object) | undefined;
prototype.initializePlaywright = async function () {
  const result = await initialize.call(this);
  const browser = result._initializer.preLaunchedBrowser._object;
  const send = this.onmessage;
  this.onmessage = (message) => {
    if (!held && message.method === "continue") {
      held = true;
      const contexts = browser.contexts();
      const pages = contexts.flatMap(context => context.pages());
      let closedContexts = 0;
      for (const context of contexts) context.once("close", () => { closedContexts += 1; });
      snapshot = () => ({ connected: browser.isConnected(), contexts: browser.contexts().length, closedContexts, pagesClosed: pages.every(page => page.isClosed()), pendingCommands: this._callbacks.size, owners: activeExportBrowserCount() });
      process.send?.({ kind: "route_in_flight" });
      return;
    }
    send(message);
  };
  return result;
};

await runMigrations();
const projectId = "cancelled-audit";
const root = path.join(projectsDir, projectId);
await mkdir(root, { recursive: true });
await writeFile(path.join(root, "index.html"), '<!doctype html><html><body><p data-bg-node-id="text">Audit cancellation</p></body></html>');
getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, "Cancellation", root);
await new ArtifactCoordinator(getSqlite()).initialize(projectId, root);
const app = createApp();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const response = await app.fetch(request);
  if (request.signal.aborted) process.send?.({ kind: "audit_settled", status: response.status, body: await response.clone().json(), resources: snapshot?.() });
  return response;
} });
process.on("message", async (message) => {
  if (message === "stop") {
    await server.stop(true);
    await closeActiveExportBrowsers();
    closeSqlite();
    process.exit(0);
  }
});
process.send?.({ kind: "ready", url: `http://127.0.0.1:${server.port}`, projectId });
