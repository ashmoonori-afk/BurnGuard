import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { interruptUserTurn, startUserTurn, type TurnDependencies } from "../src/services/turns";
import { settleProcessStreams } from "../src/adapters/process-streams";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../src/adapters/owned-process-tree";
import { sessionRoutes } from "../src/routes/session";
import { insertNormalizedEvent } from "../src/db/events";

let projectId: string;
let sessionId: string;
let projectDir: string;
let digest: string;
beforeAll(async () => { await runMigrations(); await mkdir(projectsDir, { recursive: true }); });
beforeEach(async () => {
  projectId = `review-turn-${crypto.randomUUID()}`;
  sessionId = `${projectId}-session`;
  projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, "index.html"), "base");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  digest = (await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir)).tree_digest;
});
afterEach(async () => { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(projectDir, { recursive: true, force: true }); });

function start(runAdapter: NonNullable<TurnDependencies["runAdapter"]>, text = "Create a result") {
  const turn = startUserTurn(sessionId, { type: "user.message", text }, undefined, {
    detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture", version: "test" }] }), runAdapter,
  });
  if (turn === null) throw new Error("turn reservation unavailable");
  return turn;
}

test("Given prompt-directed writes When generation succeeds Then only stage changes before commit", async () => {
  const turn = start(async (_backend, input) => {
    const target = input.prompt.match(/Write or edit files inside `([^`]+)`/)?.[1];
    expect(target).toBe(input.projectDir);
    expect(target).not.toBe(projectDir);
    await writeFile(path.join(target!, "index.html"), "success");
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "chat.delta", turnId: input.turnId, text: "1. Red. 2. Blue." });
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "status.idle", stopReason: "end_turn" });
    return { exitCode: 0 };
  });
  await turn.prepared;
  await turn.promise;
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("success");
  expect(existsSync(path.join(projectDir, ".meta", "checkpoints", `${turn.turnId}.json`))).toBe(true);
  const followup = start(async (_backend, input) => {
    expect(input.prompt).toContain("1. Red. 2. Blue.");
    expect(input.prompt).toContain("<burnguard-conversation-v1>");
    return { exitCode: 0 };
  }, "Use the second option");
  await followup.promise;
});

for (const failure of ["exit", "event"] as const) {
  test(`Given provider ${failure} failure after a write When generation ends Then live identity stays and no success checkpoint is written`, async () => {
    const turn = start(async (_backend, input) => {
      await writeFile(path.join(input.projectDir, "index.html"), "partial");
      if (failure === "event") await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "status.error", message: "provider failed", recoverable: true });
      return { exitCode: failure === "exit" ? 1 : 0 };
    });
    await turn.promise;
    expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(digest);
    expect(getSqlite().query("SELECT status FROM artifact_operations WHERE id=?").get(turn.operationId)).toEqual({ status: "failed" });
    expect(existsSync(path.join(projectDir, ".meta", "checkpoints", `${turn.turnId}.json`))).toBe(false);
  });
}

test("Given stage writes in a running turn When interrupted Then live bytes and revision are preserved", async () => {
  let entered: () => void = () => {};
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const turn = start(async (_backend, input) => {
    await writeFile(path.join(input.projectDir, "index.html"), "cancelled");
    entered();
    await new Promise<void>((resolve) => { if (input.signal?.aborted) resolve(); else input.signal?.addEventListener("abort", () => resolve(), { once: true }); });
    return { exitCode: 0 };
  });
  await ready;
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
  expect(interruptUserTurn(sessionId)).toBe(true);
  await turn.promise;
  expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(digest);
  expect(getSqlite().query("SELECT current_revision FROM projects WHERE id=?").get(projectId)).toEqual({ current_revision: 0 });
});

test("Given a pending permission When decided twice Then one durable decision and a coherent snapshot are exposed", async () => {
  await insertNormalizedEvent(sessionId, { id: crypto.randomUUID(), ts: Date.now(), type: "tool.permission_required", turnId: "permission-turn", toolCallId: "permission", tool: "Bash", input: {} });
  const request = () => sessionRoutes.request(`/api/sessions/${sessionId}/tool-decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolCallId: "permission", decision: "allow" }) });
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(409);
  const response = await sessionRoutes.request(`/api/sessions/${sessionId}/snapshot`);
  const body = await response.json();
  expect(body.data.pending_permissions).toEqual([]);
  expect(body.data.session.id).toBe(sessionId);
  expect(getSqlite().query("SELECT COUNT(*) value FROM events WHERE session_id=? AND type='tool.permission_decided'").get(sessionId)).toEqual({ value: 1 });
});

test("Given a real child tree continuously writing When its output callback fails Then the owned tree exits before failure returns", async () => {
  const script = `const child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'}); console.log(child.pid); setInterval(()=>process.stdout.write('x'.repeat(65536)),1);`;
  const proc = Bun.spawn({ cmd: [process.execPath, "-e", script], stdout: "pipe", stderr: "pipe", ...ownedProcessSpawnOptions() });
  let childPid = 0;
  const stdout = (async () => {
    const reader = proc.stdout.getReader();
    let text = "";
    try {
      while (!text.includes("\n")) {
        const part = await reader.read();
        if (part.done) throw new Error("fixture exited early");
        text += new TextDecoder().decode(part.value);
      }
      childPid = Number(text.split("\n")[0]);
      throw new Error("injected event persistence failure");
    } finally { reader.releaseLock(); }
  })();
  const stderr = new Response(proc.stderr).text().then(() => {});
  try {
    await expect(settleProcessStreams(proc, [stdout, stderr])).rejects.toThrow("injected event persistence failure");
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    expect(() => process.kill(proc.pid, 0)).toThrow();
    expect(() => process.kill(childPid, 0)).toThrow();
  } finally {
    await closeOwnedProcessTree(proc.pid);
    if (childPid > 0) { try { process.kill(childPid, "SIGKILL"); } catch {} }
  }
}, 15_000);
