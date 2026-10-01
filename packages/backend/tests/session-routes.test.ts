import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { sessionRoutes } from "../src/routes/session";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { writePreTurnSnapshot } from "../src/services/checkpoints";
import { insertNormalizedEvent } from "../src/db/events";
import { listSequencedSessionEvents } from "../src/db/event-sequence-repository";
import { admitUserTurn, isUserTurnRunning, releaseUserTurnReservation, type UserTurnAdmission } from "../src/services/turns";
import { broker } from "../src/services/broker";
import { beginVisualAlternativeOperation, finishVisualAlternativeOperation } from "../src/services/visual-alternative-operation-registry";
import { rollbackSessionAttachments, saveSessionAttachments } from "../src/services/attachments";

const projectId = `session-routes-${process.pid}`;
const sessionId = `${projectId}-session`;
let root = "";
const jsonHeaders = { "content-type": "application/json" };

beforeAll(async () => {
  await runMigrations(); root = await mkdtemp(path.join(tmpdir(), "burnguard-session-routes-")); await writeFile(path.join(root, "index.html"), "base"); await writeFile(path.join(root, "notes.txt"), "notes");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});
const graphicProjectId = `${projectId}-graphic`;
const graphicSessionId = `${graphicProjectId}-session`;
let graphicRoot = "";
afterAll(async () => {
  for (const id of [projectId, graphicProjectId]) getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
  await Promise.all([root, graphicRoot].filter((dir) => dir !== "").map((dir) => rm(dir, { recursive: true, force: true })));
});

function userMessagesAfter(id: string, after: number): number {
  return listSequencedSessionEvents(getSqlite(), id, after).filter((item) => item.event.type === "chat.user_message").length;
}

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

  test("Given stale, cross-project, and non-HTML active page targets When user messages are posted Then the route rejects them with a typed conflict", async () => {
    // Given
    const targets = ["missing.html", "../other/index.html", "notes.txt"];

    // When / Then
    for (const active_rel_path of targets) {
      const response = await request(`/api/sessions/${sessionId}/events`, "POST", { type: "user.message", text: "edit", active_rel_path });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "active_page_unavailable" } });
    }
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

  test("Given an idle session When the backend switch names any enumerated backend Then it is accepted and only an unknown id is refused", async () => {
    const gemini = await request(`/api/sessions/${sessionId}/backend`, "PATCH", { backend_id: "gemini" });
    expect(gemini.status).toBe(200);
    expect(await gemini.json()).toMatchObject({ data: { backend_id: "gemini" } });
    expect((await request(`/api/sessions/${sessionId}/backend`, "PATCH", { backend_id: "copilot" })).status).toBe(200);
    expect(getSqlite().query("SELECT backend_id FROM sessions WHERE id=?").get(sessionId)).toEqual({ backend_id: "copilot" });
    const unknown = await request(`/api/sessions/${sessionId}/backend`, "PATCH", { backend_id: "unknown" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "invalid_backend" } });
    expect((await request(`/api/sessions/${sessionId}/backend`, "PATCH", { backend_id: "claude-code" })).status).toBe(200);
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

  test("Given a multipart send whose upload is still running When the client cancels before the turn starts Then no turn starts, the reservation is released and no user message is persisted", async () => {
    const after = listSequencedSessionEvents(getSqlite(), sessionId, 0).at(-1)?.sequence ?? 0;
    const controller = new AbortController();
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", "hello");
    form.append("files", new File(["notes"], "notes.txt", { type: "text/plain" }));
    let savedPaths: readonly string[] = [];
    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form, signal: controller.signal }, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture" }, { id: "claude-code", found: true, binary_path: "fixture" }] }),
      // The real saver runs to completion; the client gives up while it is still writing.
      saveSessionAttachments: async (id, uploads) => { savedPaths = await saveSessionAttachments(id, uploads); controller.abort(); return savedPaths; },
    });
    expect(savedPaths).toHaveLength(1);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "request_cancelled" } });
    expect(isUserTurnRunning(sessionId)).toBe(false);
    // The upload was rolled back with the send.
    expect(existsSync(savedPaths[0]!)).toBe(false);
    expect(getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM attachments WHERE session_id=? AND turn_id IS NULL").get(sessionId)?.count).toBe(0);
    // The reservation is released: the next post is admitted and fails only on its body.
    const next = await request(`/api/sessions/${sessionId}/events`, "POST", {});
    expect(next.status).toBe(400);
    expect(await next.json()).toMatchObject({ error: { code: "invalid_body" } });
    expect(listSequencedSessionEvents(getSqlite(), sessionId, after).map((item) => item.event.type)).not.toContain("chat.user_message");
  });

  test("Given a session whose backend is not installed When a message is posted Then it is refused with 409 backend_unavailable, exactly one status.error and one status.idle are persisted and the refused message is not recorded as sent", async () => {
    // Given
    const after = listSequencedSessionEvents(getSqlite(), sessionId, 0).at(-1)?.sequence ?? 0;

    // When
    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ type: "user.message", text: "hello" }) }, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: false }, { id: "claude-code", found: false }] }),
    });

    // Then
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "backend_unavailable" } });
    const events = listSequencedSessionEvents(getSqlite(), sessionId, after).map(item => item.event);
    expect(events.filter(event => event.type === "status.error").map(event => event.code)).toEqual(["backend_unavailable"]);
    expect(events.filter(event => event.type === "status.idle").map(event => event.stopReason)).toEqual(["error"]);
    expect(getSqlite().query("SELECT status FROM sessions WHERE id=?").get(sessionId)).toEqual({ status: "idle" });
    // The composer keeps the draft after a refusal, so a recorded message would be duplicated by the retry.
    expect(userMessagesAfter(sessionId, after)).toBe(0);
    expect(isUserTurnRunning(sessionId)).toBe(false);
  });

  test("Given a turn that failed before preparation When another send is admitted before the failed turn has published its status.error and status.idle Then admission is refused as session_busy", async () => {
    // Given: the failed turn's status.error publication logs this diagnostic synchronously before it persists anything.
    let admission: UserTurnAdmission | null = null;
    const consoleSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      if (admission === null && args[0] === "[turn] error diagnostic") admission = admitUserTurn(sessionId, 8);
    });

    // When
    let response: Response;
    try {
      response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ type: "user.message", text: "hello" }) }, {
        detectBackends: async () => ({ backends: [{ id: "codex", found: false }, { id: "claude-code", found: false }] }),
      });
    } finally { consoleSpy.mockRestore(); }
    const observed = admission as UserTurnAdmission | null;
    if (observed?.kind === "reserved") releaseUserTurnReservation(observed.reservation);

    // Then: the failed turn still owed its terminal events and its final idle status, which would land on the admitted turn.
    expect(response.status).toBe(409);
    expect(observed?.kind).toBe("session_busy");
    expect(isUserTurnRunning(sessionId)).toBe(false);
    expect(getSqlite().query("SELECT status FROM sessions WHERE id=?").get(sessionId)).toEqual({ status: "idle" });
  });

  test("Given a session whose backend is not installed When a multipart message with an upload is posted Then the refused upload is rolled back instead of being bound to the dead turn", async () => {
    // Given
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", "hello");
    form.append("files", new File(["notes"], "refused-notes.txt", { type: "text/plain" }));
    let savedPaths: readonly string[] = [];

    // When
    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form }, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: false }, { id: "claude-code", found: false }] }),
      saveSessionAttachments: async (id, uploads) => { savedPaths = await saveSessionAttachments(id, uploads); return savedPaths; },
    });

    // Then
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "backend_unavailable" } });
    expect(savedPaths).toHaveLength(1);
    expect(existsSync(savedPaths[0]!)).toBe(false);
    expect(getSqlite().query<{ readonly count: number }, [string, string]>("SELECT COUNT(*) count FROM attachments WHERE session_id=? AND file_path=?").get(sessionId, savedPaths[0]!)?.count).toBe(0);
  });

  test("Given a visual-alternative batch leasing the project from another session When a multipart message is posted Then it is refused with 409 operation_conflict before the message is recorded and the upload is rolled back", async () => {
    // Given
    const after = listSequencedSessionEvents(getSqlite(), sessionId, 0).at(-1)?.sequence ?? 0;
    const leaseSession = `${sessionId}-alternatives`;
    expect(beginVisualAlternativeOperation(leaseSession, projectId, "lease-before-send")).not.toBeNull();
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", "hello");
    form.append("files", new File(["notes"], "leased-notes.txt", { type: "text/plain" }));
    let savedPaths: readonly string[] = [];

    // When
    let response: Response;
    try {
      response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form }, {
        detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture" }, { id: "claude-code", found: true, binary_path: "fixture" }] }),
        saveSessionAttachments: async (id, uploads) => { savedPaths = await saveSessionAttachments(id, uploads); return savedPaths; },
      });
    } finally { finishVisualAlternativeOperation(leaseSession, "lease-before-send"); }

    // Then
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "operation_conflict" } });
    expect(userMessagesAfter(sessionId, after)).toBe(0);
    expect(savedPaths).toHaveLength(1);
    expect(existsSync(savedPaths[0]!)).toBe(false);
    expect(getSqlite().query<{ readonly count: number }, [string, string]>("SELECT COUNT(*) count FROM attachments WHERE session_id=? AND file_path=?").get(sessionId, savedPaths[0]!)?.count).toBe(0);
    expect(isUserTurnRunning(sessionId)).toBe(false);
  });

  test("Given a send whose message is already recorded When the artifact operation then refuses with operation_conflict Then the route answers 500 and keeps the upload bound to the recorded turn instead of rolling it back", async () => {
    // Given: a batch leases the project the moment the user message is published.
    const after = listSequencedSessionEvents(getSqlite(), sessionId, 0).at(-1)?.sequence ?? 0;
    const leaseSession = `${sessionId}-alternatives`;
    let leased = false;
    const unsubscribe = broker.subscribe(sessionId, (event) => {
      if (event.type === "chat.user_message") leased = beginVisualAlternativeOperation(leaseSession, projectId, "lease-after-record") !== null;
    });
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", "hello");
    form.append("files", new File(["notes"], "recorded-notes.txt", { type: "text/plain" }));
    let savedPaths: readonly string[] = [];

    // When
    let response: Response;
    try {
      response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form }, {
        detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture" }, { id: "claude-code", found: true, binary_path: "fixture" }] }),
        saveSessionAttachments: async (id, uploads) => { savedPaths = await saveSessionAttachments(id, uploads); return savedPaths; },
      });
    } finally { unsubscribe(); finishVisualAlternativeOperation(leaseSession, "lease-after-record"); }

    // Then
    expect(leased).toBe(true);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "artifact_prepare_failed" } });
    expect(userMessagesAfter(sessionId, after)).toBe(1);
    expect(listSequencedSessionEvents(getSqlite(), sessionId, after).flatMap((item) => item.event.type === "status.error" ? [item.event.code] : [])).toEqual(["operation_conflict"]);
    expect(savedPaths).toHaveLength(1);
    expect(existsSync(savedPaths[0]!)).toBe(true);
    expect(getSqlite().query<{ readonly count: number }, [string, string]>("SELECT COUNT(*) count FROM attachments WHERE session_id=? AND file_path=? AND turn_id IS NOT NULL").get(sessionId, savedPaths[0]!)?.count).toBe(1);
    expect(isUserTurnRunning(sessionId)).toBe(false);
  });

  test("Given a refused multipart send When removing the rolled-back upload file fails Then the route still answers 409 with the refusal code and no unbound attachment row remains", async () => {
    // Given: the row is deleted, then the file removal fails as it does when Windows holds a handle on it.
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", "hello");
    form.append("files", new File(["notes"], "held-notes.txt", { type: "text/plain" }));
    let savedPaths: readonly string[] = [];

    // When
    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form }, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: false }, { id: "claude-code", found: false }] }),
      saveSessionAttachments: async (id, uploads) => { savedPaths = await saveSessionAttachments(id, uploads); return savedPaths; },
      rollbackSessionAttachments: async (id, paths) => { await rollbackSessionAttachments(id, paths); throw Object.assign(new Error("resource busy"), { code: "EBUSY" }); },
    });

    // Then
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "backend_unavailable" } });
    expect(savedPaths).toHaveLength(1);
    expect(getSqlite().query<{ readonly count: number }, [string, string]>("SELECT COUNT(*) count FROM attachments WHERE session_id=? AND file_path=?").get(sessionId, savedPaths[0]!)?.count).toBe(0);
    expect(isUserTurnRunning(sessionId)).toBe(false);
  });

  test("Given a graphic project on an image-capable backend When the send selects a text-only model Then the route refuses with 409 graphic_requires_authenticated_codex instead of 500 artifact_prepare_failed and records no message", async () => {
    // Given
    graphicRoot = await mkdtemp(path.join(tmpdir(), "burnguard-session-routes-graphic-"));
    await writeFile(path.join(graphicRoot, "index.html"), "<!doctype html><html><body>base</body></html>");
    getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'graphic',?,'index.html','codex',1,1)").run(graphicProjectId, graphicProjectId, graphicRoot);
    getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(graphicSessionId, graphicProjectId);

    // When
    const response = await sessionRoutes.request(`http://local/api/sessions/${graphicSessionId}/events`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ type: "user.message", text: "draw a poster", generation: { model: "text-only", effort: "low", vanilla: false, provider: "native" } }) }, {
      detectBackends: async () => ({ backends: [{
        id: "codex", found: true, binary_path: "fixture", authenticated: true,
        models: [
          { id: "text-only", label: "Text only", efforts: ["low"], image_generation: false },
          { id: "image-model", label: "Image model", efforts: ["low"], image_generation: true },
        ],
      }] }),
    });

    // Then
    const body = await response.json() as { readonly error?: { readonly code?: string } };
    expect({ status: response.status, code: body.error?.code }).toEqual({ status: 409, code: "graphic_requires_authenticated_codex" });
    const events = listSequencedSessionEvents(getSqlite(), graphicSessionId, 0).map(item => item.event);
    expect(events.filter(event => event.type === "status.error").map(event => event.code)).toEqual(["graphic_requires_authenticated_codex"]);
    expect(userMessagesAfter(graphicSessionId, 0)).toBe(0);
    expect(getSqlite().query("SELECT status FROM sessions WHERE id=?").get(graphicSessionId)).toEqual({ status: "idle" });
  });
});
