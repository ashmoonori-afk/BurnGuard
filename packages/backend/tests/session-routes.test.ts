import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { sessionRoutes } from "../src/routes/session";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { writePreTurnSnapshot } from "../src/services/checkpoints";
import { insertNormalizedEvent } from "../src/db/events";

const projectId = `session-routes-${process.pid}`;
const sessionId = `${projectId}-session`;
let root = "";
const jsonHeaders = { "content-type": "application/json" };

beforeAll(async () => {
  await runMigrations(); root = await mkdtemp(path.join(tmpdir(), "burnguard-session-routes-")); await writeFile(path.join(root, "index.html"), "base");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});
afterAll(async () => { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(root, { recursive: true, force: true }); });

function request(route: string, method = "GET", body?: unknown): Promise<Response> {
  return sessionRoutes.request(`http://local${route}`, { method, headers: body === undefined ? undefined : jsonHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("production session route boundaries", () => {
  test("Given event cursors and turn payloads When parsed Then malformed requests reject before adapter start", async () => {
    expect((await request("/api/sessions/missing/events")).status).toBe(404);
    expect((await request(`/api/sessions/${sessionId}/events?after_sequence=-1`)).status).toBe(400);
    expect((await request(`/api/sessions/${sessionId}/events?after_sequence=bad`)).status).toBe(400);
    for (const cursor of ["-1", "bad", "1tail", "9007199254740992"]) {
      expect((await request(`/api/sessions/${sessionId}/stream?after_sequence=${cursor}`)).status).toBe(400);
    }
    expect((await request(`/api/sessions/${sessionId}/events`)).status).toBe(200);
    expect((await request("/api/sessions/missing/events", "POST", {})).status).toBe(404);
    expect((await request(`/api/sessions/${sessionId}/events`, "POST", {})).status).toBe(400);
    expect((await request(`/api/sessions/${sessionId}/events`, "POST", { type: "user.message", text: "x", operation_id: "unscoped" })).status).toBe(400);
  });

  test("Given interrupt and backend requests When session state is idle Then exact status transitions remain bounded", async () => {
    expect((await request("/api/sessions/missing/interrupt", "POST")).status).toBe(404);
    expect((await request(`/api/sessions/${sessionId}/interrupt`, "POST")).status).toBe(200);
    expect((await request("/api/sessions/missing/backend", "PATCH", {})).status).toBe(404);
    expect((await request(`/api/sessions/${sessionId}/backend`, "PATCH", null)).status).toBe(400);
    expect((await request(`/api/sessions/${sessionId}/backend`, "PATCH", { backend_id: "other" })).status).toBe(400);
    expect((await request(`/api/sessions/${sessionId}/backend`, "PATCH", { backend_id: "claude-code" })).status).toBe(200);
    expect(getSqlite().query("SELECT backend_id FROM sessions WHERE id=?").get(sessionId)).toEqual({ backend_id: "claude-code" });
  });

  test("Given checkpoint restore identities When production route restores Then it mints a new exact operation", async () => {
    const coordinator = new ArtifactCoordinator(getSqlite());
    const base = await coordinator.initialize(projectId, root);
    await writePreTurnSnapshot(projectId, "route-snapshot");
    const changed = await coordinator.run({ projectId, projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "changed"); } });
    expect((await request("/api/projects/missing/checkpoints/route-snapshot/restore", "POST", {})).status).toBe(404);
    expect((await request(`/api/projects/${projectId}/checkpoints/missing/restore`, "POST", { expected_revision: 1, expected_artifact_digest: changed.resultDigest })).status).toBe(410);
    expect((await request(`/api/projects/${projectId}/checkpoints/route-snapshot/restore`, "POST", {})).status).toBe(400);
    expect((await request(`/api/projects/${projectId}/checkpoints/route-snapshot/restore`, "POST", { expected_revision: 0, expected_artifact_digest: base.tree_digest })).status).toBe(409);
    const restored = await request(`/api/projects/${projectId}/checkpoints/route-snapshot/restore`, "POST", { expected_revision: 1, expected_artifact_digest: changed.resultDigest });
    expect(restored.status).toBe(200);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("base");
  });

  test("Given tool decisions When parsed Then invalid variants reject and valid decisions persist", async () => {
    expect((await request("/api/sessions/missing/tool-decision", "POST", {})).status).toBe(404);
    expect((await request(`/api/sessions/${sessionId}/tool-decision`, "POST", null)).status).toBe(400);
    expect((await request(`/api/sessions/${sessionId}/tool-decision`, "POST", { toolCallId: "", decision: "allow" })).status).toBe(400);
    expect((await request(`/api/sessions/${sessionId}/tool-decision`, "POST", { toolCallId: "tool", decision: "other" })).status).toBe(400);
    expect((await request(`/api/sessions/${sessionId}/tool-decision`, "POST", { toolCallId: "missing", decision: "allow" })).status).toBe(409);
    for (const toolCallId of ["allow", "deny"]) await insertNormalizedEvent(sessionId, { id: `permission-${toolCallId}-${sessionId}`, ts: Date.now(), type: "tool.permission_required", turnId: "route-turn", toolCallId, tool: "Bash", input: {} });
    expect((await request(`/api/sessions/${sessionId}/tool-decision`, "POST", { toolCallId: "allow", decision: "allow", reason: "ok" })).status).toBe(200);
    expect((await request(`/api/sessions/${sessionId}/tool-decision`, "POST", { toolCallId: "deny", decision: "deny" })).status).toBe(200);
    expect(getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM events WHERE session_id=? AND direction='up'").get(sessionId)?.count).toBe(2);
  });
});
