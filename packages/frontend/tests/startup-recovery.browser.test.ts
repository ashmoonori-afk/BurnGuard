import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "../../backend/node_modules/playwright-core";
import { getSqlite } from "../../backend/src/db/sqlite-client";
import { listSequencedSessionEvents } from "../../backend/src/db/event-sequence-repository";
import { projectsDir } from "../../backend/src/lib/paths";
import { generateLaunchCapability } from "../../backend/src/security/request-authority";
import { ArtifactCoordinator } from "../../backend/src/services/artifact-coordinator";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { messages } from "../src/i18n/messages";
import type { RecoveryServerMessage } from "./fixtures/startup-recovery-server";
import type {} from "./fixtures/launch-authority-browser";

const appRoot = process.env.BG_APP_ROOT;
if (!appRoot) throw new Error("Missing isolated recovery test profile");
let browser: Browser;

beforeAll(async () => {
  for (const [file, command] of [
    ["f09-fixture.js", [process.execPath, "build", `${import.meta.dir}/fixtures/launch-authority-browser.tsx`, "--target=browser", "--format=iife"]],
    ["f09-fixture.css", [process.execPath, "run", "--cwd", "packages/frontend", "tailwindcss", "-i", "src/index.css", "-c", "tailwind.config.ts"]],
  ] as const) {
    const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
    let finished = false;
    const exited = child.exited.then(code => { finished = true; return code; });
    const completion = Promise.all([exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [code, output, errors] = await Promise.race([
        completion,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Recovery fixture compilation deadline")), 4000);
        }),
      ]);
      if (code !== 0) throw new Error(`Recovery fixture compilation failed (${code}): ${errors}`);
      await Bun.write(join(appRoot, file), output);
    } finally {
      clearTimeout(timer);
      if (!finished) child.kill("SIGKILL");
      await completion;
    }
  }
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 30_000);
  try { browser = await launchChromiumViaNode({}, controller.signal); }
  finally { clearTimeout(deadline); }
});
afterAll(async () => { await browser?.close(); });

async function startServer(sessionId: string, generation: "first" | "second") {
  const secret = generateLaunchCapability();
  const received: RecoveryServerMessage[] = [];
  const listeners = new Set<() => void>();
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/startup-recovery-server.ts")], {
    env: { ...process.env, F09_SESSION: sessionId, F09_GENERATION: generation, F09_CAPABILITY: generateLaunchCapability(), F09_SECRET: secret },
    stdout: "pipe", stderr: "pipe",
    ipc(message: RecoveryServerMessage) {
      received.push(message);
      for (const listener of listeners) listener();
    },
  });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  let stopped = false;
  const exited = child.exited.then(code => {
    stopped = true;
    for (const listener of listeners) listener();
    return code;
  });
  function waitFor(kind: RecoveryServerMessage["kind"]) {
    return new Promise<RecoveryServerMessage>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); listeners.delete(check); };
      const check = () => {
        const message = received.find(item => item.kind === kind);
        if (message) { cleanup(); resolve(message); }
        else if (stopped) { cleanup(); reject(new Error(`Recovery server exited before ${kind}`)); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Recovery server did not report ${kind}`)); }, 5000);
      listeners.add(check);
      check();
    });
  }
  async function stop() {
    if (!stopped) child.send("stop");
    let forced = false;
    const timer = setTimeout(() => { forced = true; child.kill("SIGKILL"); }, 5000);
    try { await exited; await output; }
    finally { clearTimeout(timer); }
    if (forced) throw new Error("Recovery fixture did not close its owned processes");
  }
  try {
    const ready = await waitFor("ready");
    if (ready.kind !== "ready") throw new Error("Recovery server readiness missing");
    return { origin: ready.origin, recovered: ready.recovered, secret, exited, waitFor, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function load(page: Page, entry: string) {
  await page.goto(entry);
  const ready = page.evaluate(() => globalThis.launchAuthorityTest.observe({ bootstrap: null, disabled: false, opened: 1 }));
  await page.evaluate(() => globalThis.launchAuthorityTest.mount());
  await ready;
  await page.evaluate(() => globalThis.launchAuthorityTest.settleInitialQueries());
}

test("Given a backend killed after its real commit When relaunched Then interruption preserves committed bytes and the actual composer successfully resends", async () => {
  const projectId = `f09-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const root = join(projectsDir, projectId);
  const db = getSqlite();
  await mkdir(root, { recursive: true });
  await Bun.write(join(root, "index.html"), '<!doctype html><html lang="en"><head><title>Base</title></head><body><main><h1>Base artifact</h1></main></body></html>');
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','claude-code',1,1)").run(projectId, "F09 recovery", root);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'claude-code','idle',1,1,1)").run(sessionId, projectId);
  await new ArtifactCoordinator(db).initialize(projectId, root);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(sessionId, "first");
    expect(server.recovered).toBe(0);
    await load(page, `${server.origin}/projects/${projectId}#bg-bootstrap:${server.secret}`);
    await page.locator('[data-qa="composer"] textarea').fill("Update the page");
    // Exit is subscribed at spawn, before the real UI callback starts the turn.
    const crashed = server.exited;
    let crashTimer: ReturnType<typeof setTimeout> | undefined;
    const crashDeadline = new Promise<never>((_, reject) => {
      crashTimer = setTimeout(() => reject(new Error("Recovery turn did not crash at its committed operation")), 4000);
    });
    crashDeadline.catch(() => undefined);
    try {
      await page.locator('[data-qa="composer"] textarea').press("Control+Enter");
      expect(await Promise.race([crashed, crashDeadline])).not.toBe(0);
    } finally { clearTimeout(crashTimer); }
    const committed = await readFile(join(root, "index.html"), "utf8");
    expect(committed).toContain('data-recovery-result="first"');
    expect(db.query("SELECT status FROM sessions WHERE id=?").get(sessionId)).toEqual({ status: "running" });
    const before = listSequencedSessionEvents(db, sessionId, 0);
    const operation = before.find(item => item.event.type === "artifact.operation" && item.event.outcome === "committed")?.event;
    if (operation?.type !== "artifact.operation") throw new Error("The crashed turn did not commit");
    expect(db.query("SELECT status,result_revision,result_digest FROM artifact_operations WHERE id=?").get(operation.operationId)).toEqual({ status: "committed", result_revision: operation.revision, result_digest: operation.digest });
    expect(before.some(item => item.event.type === "chat.message_end" || item.event.type === "status.idle")).toBe(false);
    await server.stop();
    await page.goto("about:blank");

    server = await startServer(sessionId, "second");
    expect(server.recovered).toBe(1);
    expect(await readFile(join(root, "index.html"), "utf8")).toBe(committed);
    const recovered = listSequencedSessionEvents(db, sessionId, 0);
    expect(recovered.slice(-2).map(item => item.event)).toMatchObject([
      { type: "status.error", code: "interrupted", recoverable: true },
      { type: "status.idle", stopReason: "error" },
    ]);
    const interruption = recovered.at(-2)?.event;
    if (interruption?.type !== "status.error") throw new Error("Recovery did not persist an error terminal");
    expect(interruption).not.toHaveProperty("notApplied");
    await load(page, `${server.origin}/projects/${projectId}#bg-bootstrap:${server.secret}`);
    await page.frameLocator("iframe[data-document-key]").locator('[data-recovery-result="first"]').waitFor({ state: "visible" });
    const card = page.locator('[data-qa="turn-error"]');
    expect(await card.count()).toBe(1);
    expect(await card.textContent()).toContain(messages["chat.error.interrupted"].en);
    expect(await card.textContent()).not.toContain(messages["chat.error.turnFailed"].en);
    expect(await page.locator('[data-qa="turn-not-applied"]').count()).toBe(0);
    expect(await page.locator('[data-turn-disposition="rejected"]').count()).toBe(1);
    expect(await page.locator('[data-turn-disposition="stopped"], [data-turn-disposition="committed"]').count()).toBe(0);
    await card.locator("button").click();
    expect(await page.locator('[data-qa="composer"] textarea').evaluate(element => element === document.activeElement)).toBe(true);
    const evidence = process.env.F09_EVIDENCE_DIR;
    if (evidence) await page.screenshot({ path: join(evidence, "recovered-desktop.png") });

    const terminal = server.waitFor("terminal");
    await page.locator('[data-qa="composer"] textarea').fill("Update the page again");
    const ready = page.evaluate(() => globalThis.launchAuthorityTest.observe({ disabled: true }));
    await page.locator('[data-qa="composer"] textarea').press("Control+Enter");
    await ready;
    expect(await terminal).toEqual({ kind: "terminal", stopReason: "end_turn" });
    await page.locator('[data-turn-disposition="committed"]').waitFor({ state: "visible" });
    await page.evaluate(() => globalThis.launchAuthorityTest.observe({ disabled: false }));
    await page.frameLocator("iframe[data-document-key]").locator('[data-recovery-result="second"]').waitFor({ state: "visible" });
    expect(await readFile(join(root, "index.html"), "utf8")).toContain('data-recovery-result="second"');
    const replay = listSequencedSessionEvents(db, sessionId, 0);
    expect(replay.filter(item => item.event.type === "status.error").map(item => item.event)).toEqual([interruption]);
    expect(replay.filter(item => item.event.type === "status.idle").at(-1)?.event).toMatchObject({ type: "status.idle", stopReason: "end_turn" });
    expect(await card.count()).toBe(1);
  } finally {
    try { await context.close(); }
    finally {
      try { await server?.stop(); }
      finally {
        db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});
