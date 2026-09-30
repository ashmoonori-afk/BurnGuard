import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BackendDetection } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { listSequencedSessionEvents } from "../src/db/event-sequence-repository";
import { sessionRoutes } from "../src/routes/session";
import { admitUserTurn, releaseUserTurnReservation, type UserTurnAdmission } from "../src/services/turns";

const prefix = `bugfind-sessions-${process.pid}`;
const jsonHeaders = { "content-type": "application/json" };
const roots: string[] = [];
const projectIds: string[] = [];

async function fixture(name: string, type: "prototype" | "graphic"): Promise<string> {
  const projectId = `${prefix}-${name}`;
  const sessionId = `${projectId}-session`;
  const root = await mkdtemp(path.join(tmpdir(), `${prefix}-${name}-`));
  roots.push(root);
  projectIds.push(projectId);
  await writeFile(path.join(root, "index.html"), "<!doctype html><html><body>base</body></html>");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,?,?,'index.html','codex',1,1)").run(projectId, projectId, type, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  return sessionId;
}

function post(sessionId: string, body: unknown, backends: BackendDetection[]): Promise<Response> {
  return sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) }, {
    detectBackends: async () => ({ backends }),
  });
}

const missingBackends: BackendDetection[] = [{ id: "codex", found: false }, { id: "claude-code", found: false }];

beforeAll(async () => { await runMigrations(); });
afterAll(async () => {
  for (const id of projectIds) getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("bugfind sessions: refused sends", () => {
  let consoleSpy: ReturnType<typeof spyOn> | null = null;
  afterEach(() => { consoleSpy?.mockRestore(); consoleSpy = null; });

  test("Given a session whose AI tool is not installed When a message is posted and refused with 409 backend_unavailable Then the refused message is not recorded as a sent chat message", async () => {
    // Given
    const sessionId = await fixture("refused", "prototype");

    // When
    const response = await post(sessionId, { type: "user.message", text: "make a hero section" }, missingBackends);

    // Then: the client is told the send failed (and the composer keeps the draft for a retry)...
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "backend_unavailable" } });
    // ...so the conversation must not already contain it, or the retry duplicates the message.
    const userMessages = listSequencedSessionEvents(getSqlite(), sessionId, 0).filter((item) => item.event.type === "chat.user_message");
    expect(userMessages).toHaveLength(0);
  });

  test("Given a graphic project on an image-capable backend When the send selects a text-only model Then the route refuses with 409 graphic_requires_authenticated_codex instead of 500 artifact_prepare_failed", async () => {
    // Given
    const sessionId = await fixture("graphic", "graphic");
    const backends: BackendDetection[] = [{
      id: "codex", found: true, binary_path: "fixture", authenticated: true,
      models: [
        { id: "text-only", label: "Text only", efforts: ["low"], image_generation: false },
        { id: "image-model", label: "Image model", efforts: ["low"], image_generation: true },
      ],
    }];

    // When
    const response = await post(sessionId, { type: "user.message", text: "draw a poster", generation: { model: "text-only", effort: "low", vanilla: false, provider: "native" } }, backends);

    // Then
    const body = await response.json();
    expect({ status: response.status, code: (body as { error?: { code?: string } }).error?.code }).toEqual({ status: 409, code: "graphic_requires_authenticated_codex" });
  });

  test("Given a turn that failed before preparation When another send is admitted before the failed turn has published its status.error and status.idle Then admission is refused as session_busy", async () => {
    // Given: the route logs this diagnostic synchronously right before it persists the failed turn's error and idle.
    const sessionId = await fixture("race", "prototype");
    let admission: UserTurnAdmission | null = null;
    consoleSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      if (admission === null && args[0] === "[turn] error diagnostic") admission = admitUserTurn(sessionId, 8);
    });

    // When
    const response = await post(sessionId, { type: "user.message", text: "hello" }, missingBackends);
    expect(response.status).toBe(409);
    const observed = admission as UserTurnAdmission | null;
    if (observed?.kind === "reserved") releaseUserTurnReservation(observed.reservation);

    // Then: the failed turn still owes its terminal events and its final setSessionStatus('idle'), which
    // would land on top of the newly admitted turn.
    expect(observed?.kind).toBe("session_busy");
  });
});
