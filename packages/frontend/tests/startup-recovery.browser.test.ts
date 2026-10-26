import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page, Request as BrowserRequest } from "../../backend/node_modules/playwright-core";
import { getSqlite } from "../../backend/src/db/sqlite-client";
import { listSequencedSessionEvents } from "../../backend/src/db/event-sequence-repository";
import { projectsDir } from "../../backend/src/lib/paths";
import { generateLaunchCapability } from "../../backend/src/security/request-authority";
import { ArtifactCoordinator } from "../../backend/src/services/artifact-coordinator";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import { messages } from "../src/i18n/messages";
import type { RecoveryServerMessage } from "./fixtures/startup-recovery-server";
import type {} from "./fixtures/launch-authority-browser";

type F09InputRecord = {
  readonly phase: string;
  readonly epoch_ms: number;
  readonly input_id: number | null;
  readonly target_id: number | null;
  readonly input_chars: number | null;
  readonly input_active: boolean;
  readonly input_disabled: boolean | null;
  readonly last_button_disabled: boolean | null;
  readonly last_button_is_send: boolean;
  readonly no_ai_tool: boolean;
  readonly key: "Enter" | "Control" | "Meta" | null;
  readonly ctrl: boolean | null;
  readonly meta: boolean | null;
  readonly composing: boolean | null;
  readonly prevented: boolean | null;
  readonly trusted: boolean | null;
  readonly state: Readonly<Pick<ReturnType<typeof globalThis.launchAuthorityTest.state>,
    "readyState" | "opened" | "closed" | "disabled" | "reason" | "expired">> | null;
};
declare global {
  var f09InputEvidence: { records: F09InputRecord[]; truncated: boolean };
}

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
  const started = performance.now();
  const phases: { phase: string; ms: number; epoch_ms: number }[] = [];
  const mark = (phase: string) => { if (phases.length < 48) phases.push({ phase, ms: Math.round(performance.now() - started), epoch_ms: Date.now() }); };
  mark("spawn");
  const secret = generateLaunchCapability();
  const received: RecoveryServerMessage[] = [];
  const listeners = new Set<() => void>();
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/startup-recovery-server.ts")], {
    env: { ...process.env, F09_SESSION: sessionId, F09_GENERATION: generation, F09_CAPABILITY: generateLaunchCapability(), F09_SECRET: secret },
    stdout: "pipe", stderr: "pipe",
    ipc(message: RecoveryServerMessage) {
      mark(`ipc-${message.kind}`);
      received.push(message);
      for (const listener of listeners) listener();
    },
  });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  let stopped = false;
  const exited = child.exited.then(code => {
    mark("exited");
    stopped = true;
    for (const listener of listeners) listener();
    return code;
  });
  function waitFor(kind: RecoveryServerMessage["kind"]) {
    mark(`wait-${kind}`);
    return new Promise<RecoveryServerMessage>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); listeners.delete(check); };
      const check = () => {
        const message = received.find(item => item.kind === kind);
        if (message) { cleanup(); resolve(message); }
        else if (stopped) { cleanup(); reject(new Error(`Recovery server exited before ${kind}`)); }
      };
      const timer = setTimeout(() => { mark(`deadline-${kind}`); cleanup(); reject(new Error(`Recovery server did not report ${kind}`)); }, 5000);
      listeners.add(check);
      check();
    });
  }
  async function stop() {
    mark("cleanup-begin");
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
    return {
      origin: ready.origin, recovered: ready.recovered, secret, exited, waitFor, stop, mark,
      phases: () => ({ generation, phases, truncated: phases.length === 48, received: received.map(message => message.kind) }),
      childPhases: async () => (await output).flatMap(text => text.split("\n").filter(line => line.startsWith("F09_FIXTURE_PHASE "))).slice(0, 49),
    };
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

test("Given a recovered workspace connection When it stays quiet beyond the default idle cutoff Then the composer remains connected", async () => {
  const projectId = `f09-idle-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const root = join(projectsDir, projectId);
  const db = getSqlite();
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await mkdir(root, { recursive: true });
    await Bun.write(join(root, "index.html"), "<!doctype html><html><body><h1>Saved artifact</h1></body></html>");
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','claude-code',1,1)")
      .run(projectId, "F09 idle recovery", root);
    db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'claude-code','idle',1,1,1)")
      .run(sessionId, projectId);
    await new ArtifactCoordinator(db).initialize(projectId, root);
    server = await startServer(sessionId, "second");
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await load(page, `${server.origin}/projects/${projectId}#bg-bootstrap:${server.secret}`);
    const observed = await page.evaluate(() => new Promise<ReturnType<typeof globalThis.launchAuthorityTest.state>>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        document.removeEventListener("f08:state", check);
      };
      const check = () => {
        const state = globalThis.launchAuthorityTest.state();
        if (state.readyState !== EventSource.OPEN || state.opened !== 1) {
          cleanup();
          reject(new Error("recovery_stream_lost_during_quiet_window"));
        }
      };
      // Connection lifetime is the behavior under test, not a delay to settle UI work.
      // This window crosses the default 10s idle cutoff but precedes the 30s heartbeat.
      const timer = window.setTimeout(() => {
        cleanup();
        resolve(globalThis.launchAuthorityTest.state());
      }, 15000);
      document.addEventListener("f08:state", check);
      check();
    }));
    expect(observed).toMatchObject({ readyState: 1, opened: 1, disabled: false, reason: null });
  } finally {
    try { await context?.close(); }
    finally {
      try { await server?.stop(); }
      finally {
        db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
        await rm(root, { recursive: true, force: true });
      }
    }
  }
}, 30000);

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
  await context.addInitScript(() => {
    // Primitive state only: never retain entered text, URLs, headers or authority.
    globalThis.f09InputEvidence = { records: [], truncated: false };
    const identities = new WeakMap<Element, number>();
    let nextIdentity = 0;
    const identity = (element: Element | null) => {
      if (!element) return null;
      const prior = identities.get(element);
      if (prior !== undefined) return prior;
      const id = ++nextIdentity;
      identities.set(element, id);
      return id;
    };
    const capture = (phase: string, event?: Event) => {
      const evidence = globalThis.f09InputEvidence;
      if (evidence.records.length >= 128) { evidence.truncated = true; return; }
      const composer = document.querySelector('[data-qa="composer"]');
      const input = composer?.querySelector("textarea") ?? null;
      const buttons = composer?.querySelectorAll("button");
      const last = buttons?.item(buttons.length - 1);
      const state = globalThis.launchAuthorityTest?.state();
      const keyboard = event instanceof KeyboardEvent ? event : null;
      const key = keyboard?.key;
      evidence.records.push({
        phase, epoch_ms: Date.now(),
        input_id: identity(input),
        target_id: identity(event?.target instanceof Element ? event.target : null),
        input_chars: input?.value.length ?? null,
        input_active: input !== null && input === document.activeElement,
        input_disabled: input?.disabled ?? null,
        last_button_disabled: last?.disabled ?? null,
        last_button_is_send: Boolean(last?.querySelector(".lucide-send")),
        no_ai_tool: Boolean(composer?.querySelector('[data-bg-send-blocked="no-ai-tool"]')),
        key: key === "Enter" || key === "Control" || key === "Meta" ? key : null,
        ctrl: keyboard?.ctrlKey ?? null,
        meta: keyboard?.metaKey ?? null,
        composing: keyboard?.isComposing ?? (event instanceof InputEvent ? event.isComposing : null),
        prevented: event?.defaultPrevented ?? null,
        trusted: event?.isTrusted ?? null,
        state: state ? {
          readyState: state.readyState, opened: state.opened, closed: state.closed,
          disabled: state.disabled, reason: state.reason, expired: state.expired,
        } : null,
      });
    };
    document.addEventListener("f08:state", () => capture("state"));
    document.addEventListener("input", event => {
      if (event.target instanceof HTMLTextAreaElement) capture("input", event);
    }, true);
    for (const capturing of [true, false]) document.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === "Control" || event.key === "Meta") {
        capture(capturing ? "keydown-capture" : "keydown-bubble", event);
      }
    }, capturing);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const postKind = (request: BrowserRequest) => {
    if (!server || request.method() !== "POST") return null;
    const url = new URL(request.url());
    if (url.origin !== server.origin) return null;
    return url.pathname.endsWith("/events") ? "events" : url.pathname.endsWith("/documents") ? "documents" : "other";
  };
  page.on("request", request => { const kind = postKind(request); if (kind) server?.mark(`${kind}-request`); });
  page.on("response", response => { const kind = postKind(response.request()); if (kind) server?.mark(`${kind}-response-${response.status()}`); });
  page.on("requestfailed", request => { const kind = postKind(request); if (kind) server?.mark(`${kind}-request-failed`); });
  const browserPhases = () => Promise.all(page.frames().map(async (frame, index) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const snapshot = frame.evaluate(() => globalThis.f09InputEvidence ?? null).catch(() => ({ unavailable: true }));
    try {
      return { frame: index, main: frame === page.mainFrame(), evidence: await Promise.race([
        snapshot,
        new Promise<{ unavailable: true }>(resolve => { timer = setTimeout(() => resolve({ unavailable: true }), 500); }),
      ]) };
    } finally { clearTimeout(timer); }
  }));
  let failed = false;
  let beforeResend = 0;
  try {
    server = await startServer(sessionId, "first");
    expect(server.recovered).toBe(0);
    await load(page, `${server.origin}/projects/${projectId}#bg-bootstrap:${server.secret}`);
    server.mark("first-fill-begin");
    await page.locator('[data-qa="composer"] textarea').fill("Update the page");
    server.mark("first-fill-end");
    // Exit is subscribed at spawn, before the real UI callback starts the turn.
    const crashed = server.exited;
    let crashTimer: ReturnType<typeof setTimeout> | undefined;
    const crashDeadline = new Promise<never>((_, reject) => {
      crashTimer = setTimeout(() => { server?.mark("first-crash-deadline"); reject(new Error("Recovery turn did not crash at its committed operation")); }, 4000);
    });
    crashDeadline.catch(() => undefined);
    try {
      server.mark("first-press-begin");
      await page.locator('[data-qa="composer"] textarea').press("Control+Enter");
      server.mark("first-press-end");
      expect(await Promise.race([crashed, crashDeadline])).not.toBe(0);
      server.mark("first-crash-observed");
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
    console.error(JSON.stringify({ event: "f09_first_turn_phases", parent: server.phases(), child: await server.childPhases(), browser: await browserPhases() }));
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

    beforeResend = listSequencedSessionEvents(db, sessionId, 0).length;
    const terminal = server.waitFor("terminal");
    terminal.catch(() => server?.mark("terminal-rejected"));
    server.mark("fill-begin");
    await page.locator('[data-qa="composer"] textarea').fill("Update the page again");
    server.mark("fill-end");
    const ready = page.evaluate(() => globalThis.launchAuthorityTest.observe({ disabled: true }));
    ready.catch(() => server?.mark("disabled-observer-rejected"));
    server.mark("press-begin");
    await page.locator('[data-qa="composer"] textarea').press("Control+Enter");
    server.mark("press-end");
    await ready;
    server.mark("disabled-observed");
    expect(await terminal).toEqual({ kind: "terminal", stopReason: "end_turn" });
    await page.locator('[data-turn-disposition="committed"]').waitFor({ state: "visible" });
    await page.evaluate(() => globalThis.launchAuthorityTest.observe({ disabled: false }));
    await page.frameLocator("iframe[data-document-key]").locator('[data-recovery-result="second"]').waitFor({ state: "visible" });
    expect(await readFile(join(root, "index.html"), "utf8")).toContain('data-recovery-result="second"');
    const replay = listSequencedSessionEvents(db, sessionId, 0);
    expect(replay.filter(item => item.event.type === "status.error").map(item => item.event)).toEqual([interruption]);
    expect(replay.filter(item => item.event.type === "status.idle").at(-1)?.event).toMatchObject({ type: "status.idle", stopReason: "end_turn" });
    expect(await card.count()).toBe(1);
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({
      event: "f09_recovery_failure",
      browser: await browserPhases(),
      parent: server?.phases(),
      resendEvents: listSequencedSessionEvents(db, sessionId, 0).slice(beforeResend).map(item => item.event.type),
      session: db.prepare("SELECT status FROM sessions WHERE id=?").get(sessionId),
      operations: db.prepare("SELECT status,COUNT(*) AS count FROM artifact_operations WHERE project_id=? GROUP BY status").all(projectId),
    }));
    throw error;
  } finally {
    const observedBrowser = await browserPhases();
    try { await context.close(); }
    finally {
      try { await server?.stop(); }
      finally {
        try {
          if (server) console.error(JSON.stringify({ event: "f09_recovery_phases", failed, parent: server.phases(), child: await server.childPhases(), browser: observedBrowser }));
        } finally {
          db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }
});
