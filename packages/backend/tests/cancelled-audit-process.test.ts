import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDesignAuditResult } from "@bg/shared";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../src/adapters/owned-process-tree";

test("Given a real API audit with a route command in flight When its HTTP client cancels Then the backend survives, closes resources, and serves an intact later audit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cancelled-audit-"));
  type Message = { kind: string; url: string; projectId: string; status: number; body: unknown; resources: unknown };
  const ready = Promise.withResolvers<Message>();
  const routed = Promise.withResolvers<Message>();
  const settled = Promise.withResolvers<Message>();
  const signals = new Map([["ready", ready], ["route_in_flight", routed], ["audit_settled", settled]]);
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/cancelled-audit-server.ts")], {
    ...ownedProcessSpawnOptions(), env: { ...process.env, BG_APP_ROOT: root }, stdout: "pipe", stderr: "pipe",
    ipc(message: Message) { signals.get(message.kind)?.resolve(message); },
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exited = child.exited.then(async code => { throw new Error(`Audit server exited ${code}\n${await stdout}\n${await stderr}`); });
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => deadline.reject(new Error("Audit cancellation event deadline exceeded")), 55_000);
  const event = (signal: Promise<Message>) => Promise.race([signal, exited, deadline.promise]);
  // Observe exit/deadline even if a preceding assertion fails and teardown wins.
  const done = Promise.allSettled([exited, deadline.promise]);
  const controller = new AbortController();
  try {
    const { url, projectId } = await event(ready.promise);
    const cancelled = fetch(`${url}/api/projects/${projectId}/design-audit`, { signal: controller.signal }).then(response => ({ response }), error => ({ error }));
    await event(routed.promise);
    controller.abort();
    expect(await cancelled).toHaveProperty("error");
    const result = await event(settled.promise);
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
    clearTimeout(timer);
    deadline.reject(new Error("Test finished"));
    if (child.exitCode === null) await closeOwnedProcessTree(child.pid);
    await child.exited;
    await done;
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
