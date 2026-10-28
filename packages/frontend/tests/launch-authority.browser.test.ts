import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { getSqlite } from "../../backend/src/db/sqlite-client";
import { insertNormalizedEvent } from "../../backend/src/db/events";
import { projectsDir } from "../../backend/src/lib/paths";
import { generateLaunchCapability } from "../../backend/src/security/request-authority";
import { ArtifactCoordinator } from "../../backend/src/services/artifact-coordinator";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import type { AuthorityBrowserState } from "./fixtures/launch-authority-browser";
import type { AuthorityServerMessage } from "./fixtures/launch-authority-server";

let browser: Browser;
const appRoot = process.env.BG_APP_ROOT;
if (!appRoot) throw new Error("Missing isolated authority test profile");
async function compile(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Launch authority fixture compilation failed (${code}): ${errors}`);
  return output;
}
beforeAll(async () => {
  const [script, styles] = await Promise.all([
    compile([process.execPath, "build", `${import.meta.dir}/fixtures/launch-authority-browser.tsx`, "--target=browser", "--format=iife"]),
    compile([process.execPath, "run", "--cwd", "packages/frontend", "tailwindcss", "-i", "src/index.css", "-c", "tailwind.config.ts"]),
  ]);
  await Bun.write(join(appRoot, "f08-fixture.js"), script);
  await Bun.write(join(appRoot, "f08-fixture.css"), styles);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 30_000);
  try { browser = await launchChromiumViaNode({}, controller.signal); }
  finally { clearTimeout(deadline); }
});
afterAll(async () => { await browser?.close(); });

type RequestRecord = Extract<AuthorityServerMessage, { kind: "request" }> & { generation: number };
async function startServer(port: number, capability: string, secret: string, requests: RequestRecord[], generation: number) {
  const messages: AuthorityServerMessage[] = [];
  const listeners = new Set<() => void>();
  // Bun.which uses the startup PATH; isolate tool discovery before spawning.
  const toolPath = await mkdtemp(join(projectsDir, "f08-tool-path-"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/launch-authority-server.ts")], {
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH")), PATH: toolPath, F08_PORT: String(port), F08_CAPABILITY: capability, F08_SECRET: secret },
    stdout: "pipe", stderr: "pipe",
    ipc(message: AuthorityServerMessage) {
      messages.push(message);
      if (message.kind === "request") requests.push({ ...message, generation });
      for (const listener of listeners) listener();
    },
  });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const waitFor = (kind: AuthorityServerMessage["kind"]) => new Promise<AuthorityServerMessage>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); listeners.delete(check); };
    const check = () => {
      const message = messages.find((entry) => entry.kind === kind);
      if (message) { cleanup(); resolve(message); }
      else if (child.exitCode !== null) { cleanup(); reject(new Error(`Authority server exited before ${kind}`)); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Authority server did not report ${kind}`)); }, 5000);
    listeners.add(check);
    check();
  });
  void child.exited.then(() => { for (const listener of listeners) listener(); });
  const ready = await waitFor("ready");
  if (ready.kind !== "ready") throw new Error("Missing authority server readiness");
  return {
    origin: ready.origin, pid: ready.pid, waitFor,
    async holdSnapshot() { const held = waitFor("holding"); child.send("hold-snapshot"); await held; },
    releaseSnapshot() { child.send("release-snapshot"); },
    async stop() {
      if (child.exitCode === null) child.kill();
      await child.exited;
      await output;
    },
  };
}

async function fixture() {
  const projectId = `f08-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const root = join(projectsDir, projectId);
  await mkdir(root, { recursive: true });
  await Bun.write(join(root, "index.html"), '<!doctype html><html><body><h1 data-f08-saved>Saved F08 artifact</h1></body></html>');
  const db = getSqlite();
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, "F08 saved project", root);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  await new ArtifactCoordinator(db).initialize(projectId, root);
  await insertNormalizedEvent(sessionId, { id: `${projectId}-message`, ts: 1, type: "chat.user_message", turnId: "saved-turn", text: "F08 saved history", attachmentCount: 0 });
  const requests: RequestRecord[] = [];
  let generation = 1;
  let capability = generateLaunchCapability();
  let secret = generateLaunchCapability();
  let server = await startServer(0, capability, secret, requests, generation);
  const origin = server.origin;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const network: { kind: string; at: number; resource: string; status?: number; code?: string }[] = [];
  const record = (entry: Omit<(typeof network)[number], "at">) => {
    if (network.length < 80) network.push({ ...entry, at: Date.now() });
  };
  const resource = (url: string) => new URL(url).pathname.split("/").at(-1) ?? "";
  page.on("request", (request) => record({ kind: "request", resource: resource(request.url()) }));
  page.on("response", (response) => record({ kind: "response", resource: resource(response.url()), status: response.status() }));
  page.on("requestfailed", (request) => record({
    kind: "request-failed", resource: resource(request.url()),
    code: request.failure()?.errorText.match(/^net::[A-Z_]+$/)?.[0] ?? "other",
  }));
  const entry = () => `${origin}/projects/${projectId}#bg-bootstrap:${secret}`;
  return {
    page, context, requests, projectId, sessionId, entry,
    server: () => server,
    async load() {
      await page.goto(entry());
      let snapshots = 0;
      const resynced = page.waitForResponse((response) => response.url().endsWith("/snapshot") && ++snapshots === 2);
      const ready = observe(page, { bootstrap: null, draft: "", disabled: false, opened: 1 });
      await page.evaluate(() => globalThis.launchAuthorityTest.mount());
      await Promise.all([ready, resynced.then((response) => response.finished())]);
      await page.evaluate(() => globalThis.launchAuthorityTest.settleInitialQueries());
    },
    async restart() {
      const oldPid = server.pid;
      await server.stop();
      record({ kind: "server-exited", resource: "server" });
      generation += 1;
      capability = generateLaunchCapability();
      secret = generateLaunchCapability();
      server = await startServer(Number(new URL(origin).port), capability, secret, requests, generation);
      record({ kind: "server-ready", resource: "server" });
      expect(server.pid).not.toBe(oldPid);
    },
    async diagnose() {
      const state = await page.evaluate(() => globalThis.launchAuthorityTest.state());
      console.error(JSON.stringify({
        event: "authority_restart_failure", platform: process.platform, generation,
        state: { ...state, draft: undefined }, network,
        requests: requests.map(({ generation, method, path, status }) => ({ generation, method, resource: resource(`http://fixture${path}`), status })),
      }));
    },
    async close() {
      server.releaseSnapshot();
      await context.close();
      await server.stop();
      db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
      await rm(root, { recursive: true, force: true });
    },
  };
}
const observe = (page: Page, state: Partial<AuthorityBrowserState>) => page.evaluate((expected) => globalThis.launchAuthorityTest.observe(expected), state);

describe("expired launch authority with real middleware and backend processes", () => {
  test("Given A and a mounted draft When B answers the disconnect check Then one snapshot closes the stale stream and a legitimate B entry restores the saved project", async () => {
    const f = await fixture();
    try {
      await f.load();
      await f.page.locator("textarea").fill("F08 unsent draft");
      await f.page.evaluate(() => globalThis.launchAuthorityTest.rememberComposer());
      const oldCookies = await f.context.cookies();
      expect(oldCookies.filter((cookie) => cookie.name === "burnguard_capability").map(({ httpOnly, sameSite, path }) => ({ httpOnly, sameSite, path }))).toEqual([{ httpOnly: true, sameSite: "Strict", path: "/api" }]);
      const oldCapability = oldCookies.find((cookie) => cookie.name === "burnguard_capability")?.value;
      if (!oldCapability) throw new Error("A did not establish its real cookie");
      // Keep the browser offline during the restart, then let B answer the first snapshot.
      await f.page.route("**/snapshot", async (route) => {
        await restarted;
        await route.continue();
      });
      let releaseRestart: () => void = () => {};
      const restarted = new Promise<void>((resolve) => { releaseRestart = resolve; });
      const expired = observe(f.page, { expired: true, banner: true, disabled: true, reason: "authority", closed: 1, sources: 1, readyState: 2 });
      await f.restart();
      await f.server().holdSnapshot();
      releaseRestart();
      await f.server().waitFor("snapshot-held");
      await f.page.evaluate(() => globalThis.launchAuthorityTest.duplicateErrors());
      f.server().releaseSnapshot();
      await expired;
      expect(f.requests.filter((request) => request.generation === 2 && request.path.endsWith("/snapshot")).map(({ status }) => status)).toEqual([403]);
      for (const headers of [new Headers({ cookie: `burnguard_capability=${oldCapability}` }), new Headers({ "x-burnguard-capability": oldCapability })]) {
        const response = await fetch(`${new URL(f.entry()).origin}/api/projects/${f.projectId}`, { headers });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
      }
      expect(await f.page.locator("textarea").inputValue()).toBe("F08 unsent draft");
      expect(await f.page.evaluate(() => globalThis.launchAuthorityTest.sameComposer())).toBe(true);
      await f.page.evaluate(() => globalThis.launchAuthorityTest.refetchWorkspace());
      expect(await f.page.evaluate(() => globalThis.launchAuthorityTest.sameComposer())).toBe(true);
      expect(await f.page.locator("textarea").inputValue()).toBe("F08 unsent draft");
      expect(await f.page.locator("[data-authority-expired]").count()).toBe(1);
      const beforeMutation = f.requests.length;
      expect(await f.page.evaluate(() => globalThis.launchAuthorityTest.attemptMutation())).toEqual({ code: "forbidden", status: 403 });
      expect(f.requests).toHaveLength(beforeMutation);
      expect(await f.page.locator("[data-authority-expired] button").count()).toBe(0);
      expect(await f.page.evaluate(() => location.hash)).toBe("");
      expect(await f.page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
      await f.page.unroute("**/snapshot");

      await f.page.reload();
      const denied = observe(f.page, { bootstrap: "denied", expired: true, sources: 0 });
      await f.page.evaluate(() => globalThis.launchAuthorityTest.mount());
      await denied;
      expect(await f.page.locator('[data-bootstrap-state="denied"] button').count()).toBe(0);
      expect(await f.page.locator('[data-bootstrap-state="network"]').count()).toBe(0);
      expect(f.requests.filter((request) => request.generation === 2 && request.path === "/api/bootstrap").map(({ status }) => status)).toEqual([403]);

      // A normal launcher creates a fresh document, not a same-document hash navigation.
      await f.page.goto("about:blank");
      await f.page.goto(f.entry());
      const recovered = observe(f.page, { bootstrap: null, expired: false, banner: false, disabled: false, opened: 1 });
      await f.page.evaluate(() => globalThis.launchAuthorityTest.mount());
      await recovered;
      expect(f.requests.filter((request) => request.generation === 2 && request.path === "/api/bootstrap").map(({ status }) => status)).toEqual([403, 200]);
      expect(await f.page.locator("textarea").inputValue()).toBe("F08 unsent draft");
      expect(await f.page.evaluate(() => location.pathname)).toBe(`/projects/${f.projectId}`);
      expect(f.requests.filter((request) => request.generation === 2 && request.path === `/api/projects/${f.projectId}` && request.status === 200)).toHaveLength(1);
      expect(f.requests.some((request) => request.generation === 2 && request.path === `/api/sessions/${f.sessionId}/events` && request.status === 200)).toBe(true);
    } catch (error) {
      try { await f.diagnose(); }
      finally { throw error; }
    } finally { await f.close(); }
  });

  test("Given a valid launch cookie When the page reloads without its spent secret Then real bootstrap and the saved project remain accessible", async () => {
    const f = await fixture();
    try {
      await f.load();
      expect(await f.page.evaluate(() => location.hash)).toBe("");
      await f.page.reload();
      const ready = observe(f.page, { bootstrap: null, expired: false, disabled: false, opened: 1 });
      await f.page.evaluate(() => globalThis.launchAuthorityTest.mount());
      await ready;
      expect(f.requests.filter((request) => request.path === "/api/bootstrap").map(({ status }) => status)).toEqual([200, 200]);
      expect(f.requests.filter((request) => request.path === `/api/projects/${f.projectId}` && request.status === 200)).toHaveLength(2);
    } finally { await f.close(); }
  });

  test("Given a real browser network outage When connectivity returns and Reconnect is clicked Then the retained launch secret reaches real middleware and opens the saved project", async () => {
    const f = await fixture();
    try {
      await f.page.goto(f.entry());
      await f.context.setOffline(true);
      const offline = observe(f.page, { bootstrap: "network", expired: false, sources: 0 });
      await f.page.evaluate(() => globalThis.launchAuthorityTest.mount());
      await offline;
      expect(f.requests.filter((request) => request.path === "/api/bootstrap")).toEqual([]);
      expect(await f.page.locator('[data-bootstrap-state="network"] button').count()).toBe(1);
      await f.context.setOffline(false);
      const recovered = observe(f.page, { bootstrap: null, expired: false, disabled: false, opened: 1 });
      await f.page.locator('[data-bootstrap-state="network"] button').click();
      await recovered;
      expect(f.requests.filter((request) => request.path === "/api/bootstrap").map(({ status }) => status)).toEqual([200]);
      expect(f.requests.filter((request) => request.path === `/api/projects/${f.projectId}` && request.status === 200)).toHaveLength(1);
    } finally { await f.close(); }
  });

  test("Given A stops before B starts When B rejects the stale native stream Then one authority check identifies expiry without losing the mounted draft", async () => {
    const f = await fixture();
    try {
      await f.load();
      await f.page.locator("textarea").fill("F08 unsent restart draft");
      const disconnected = observe(f.page, { readyState: 0 });
      await f.server().stop();
      await disconnected;
      const deniedStream = f.page.waitForResponse((response) => response.url().includes("/stream?") && response.status() === 403);
      const closed = observe(f.page, { readyState: 2, disabled: true, expired: true, banner: true, reason: "authority" });
      await f.restart();
      await Promise.all([deniedStream, closed]);
      const state = await f.page.evaluate(() => globalThis.launchAuthorityTest.state());
      expect(f.requests.filter((request) => request.generation === 2 && request.path.endsWith("/stream")).map(({ status }) => status)).toEqual([403]);
      expect(f.requests.filter((request) => request.generation === 2 && request.path.endsWith("/snapshot")).map(({ status }) => status)).toEqual([403]);
      expect(state).toMatchObject({ expired: true, banner: true, reason: "authority", draft: "F08 unsent restart draft", sources: 1, snapshotNetworkFailures: 0 });
    } catch (error) {
      try { await f.diagnose(); }
      finally { throw error; }
    } finally { await f.close(); }
  });
});
