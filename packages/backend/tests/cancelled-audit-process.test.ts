import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDesignAuditResult } from "@bg/shared";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../src/adapters/owned-process-tree";

test("Given a real API audit with a route command in flight When its HTTP client cancels Then the backend survives, closes resources, and serves an intact later audit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cancelled-audit-"));
  type Message = { kind: string; url: string; projectId: string; status: number; body: unknown; resources: unknown; errorcode?: string };
  const started = Date.now();
  const phases: { readonly phase: string; readonly ms: number; readonly status?: number; readonly errorcode?: string }[] = [];
  const record = (phase: string, status?: number, errorcode?: string) => {
    if (phases.length < 12) phases.push({ phase, ms: Date.now() - started, ...(status === undefined ? {} : { status }), ...(errorcode === undefined ? {} : { errorcode }) });
  };
  const ready = Promise.withResolvers<Message>();
  const routed = Promise.withResolvers<Message>();
  const settled = Promise.withResolvers<Message>();
  const premature = Promise.withResolvers<void>();
  const signals = new Map([["ready", ready], ["route_in_flight", routed], ["audit_settled", settled]]);
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/cancelled-audit-server.ts")], {
    ...ownedProcessSpawnOptions(), env: { ...process.env, BG_APP_ROOT: root }, stdout: "ignore", stderr: "pipe",
    ipc(message: Message) {
      if (["ready", "browser_connected", "route_in_flight", "audit_settled", "response_before_held"].includes(message.kind)) record(message.kind, message.status, message.errorcode);
      if (message.kind === "response_before_held") premature.resolve();
      signals.get(message.kind)?.resolve(message);
    },
  });
  const stderr = new Response(child.stderr).text();
  const exited = child.exited.then(code => { record("child_exit", code); throw new Error(`Audit server exited: ${JSON.stringify(phases)}`); });
  const deadline = Promise.withResolvers<never>();
  let waitingFor = "ready";
  const timer = setTimeout(() => deadline.reject(new Error(`Audit cancellation event deadline exceeded while waiting for ${waitingFor}: ${JSON.stringify(phases)}`)), 55_000);
  const event = (label: string, signal: Promise<Message>) => { waitingFor = label; return Promise.race([signal, exited, deadline.promise]); };
  // Observe exit/deadline even if a preceding assertion fails and teardown wins.
  const done = Promise.allSettled([exited, deadline.promise]);
  const controller = new AbortController();
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { url, projectId } = await event("ready", ready.promise);
    const unexpectedCompletion = premature.promise.then(() => { throw new Error(`Audit request completed before cancellation: ${JSON.stringify(phases)}`); });
    const routeInFlight = event("route_in_flight", Promise.race([
      routed.promise,
      unexpectedCompletion,
    ]));
    let requestSettled = false;
    record("request_started");
    const cancelled = fetch(`${url}/api/projects/${projectId}/design-audit`, { signal: controller.signal }).then(
      response => { requestSettled = true; record("request_completed", response.status); premature.resolve(); return { response }; },
      error => { requestSettled = true; record("request_failed", undefined, "transport_error"); premature.resolve(); return { error }; },
    );
    await routeInFlight;
    // Time is the behavior: the held route must keep this request pending beyond Bun's default 10-second idle cutoff.
    const quiet = Promise.withResolvers<void>();
    quietTimer = setTimeout(() => quiet.resolve(), 11_000);
    waitingFor = "quiet_held_route";
    await Promise.race([quiet.promise, unexpectedCompletion, exited, deadline.promise]);
    expect(requestSettled).toBe(false);
    controller.abort();
    expect(await cancelled).toHaveProperty("error");
    const result = await event("audit_settled", settled.promise);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "audit_unavailable" } });
    expect(result.resources).toEqual({ connected: false, contexts: 0, closedContexts: 1, pagesClosed: true, pendingCommands: 0, owners: 0 });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    const response = await fetch(`${url}/api/projects/${projectId}/design-audit`);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: unknown };
    expect(parseDesignAuditResult(body.data).project_id).toBe(projectId);
    child.send("stop");
    expect(await child.exited).toBe(0);
    expect(await stderr).toBe("");
    console.log(`Real local API: cancelled audit=503, health=200, subsequent audit=200; Chromium owners=0`);
  } finally {
    controller.abort();
    if (quietTimer !== undefined) clearTimeout(quietTimer);
    clearTimeout(timer);
    deadline.reject(new Error("Test finished"));
    if (child.exitCode === null) await closeOwnedProcessTree(child.pid);
    await child.exited;
    await done;
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
