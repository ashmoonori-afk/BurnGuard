import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { MAX_REQUEST_BODY_BYTES, MAX_USER_MESSAGE_CHARS, requestBodyLimitFor } from "../src/security/request-limits";
import { createApp } from "../src/server";
import { hasTurnCapacity, releaseUserTurnReservation, reserveUserTurn } from "../src/services/turns";

const MiB = 1024 * 1024;
const tempDirs: string[] = [];
const projectIds: string[] = [];
const sessionIds: string[] = [];

function insertProjectWithSession(dirPath: string): { projectId: string; sessionId: string } {
  const projectId = `project-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  const now = Date.now();
  const db = getSqlite();
  db.prepare(`INSERT INTO projects (id, name, type, design_system_id, dir_path, entrypoint, backend_id, created_at, updated_at) VALUES (?, ?, 'prototype', NULL, ?, 'index.html', 'claude-code', ?, ?)`).run(projectId, projectId, dirPath, now, now);
  db.prepare(`INSERT INTO sessions (id, project_id, backend_id, status, usage_input_tokens, usage_output_tokens, usage_cache_read, usage_cache_write, created_at, updated_at, last_active_at) VALUES (?, ?, 'claude-code', 'idle', 0, 0, 0, 0, ?, ?, ?)`).run(sessionId, projectId, now, now, now);
  projectIds.push(projectId);
  sessionIds.push(sessionId);
  return { projectId, sessionId };
}

beforeAll(async () => { await runMigrations(); });

afterAll(async () => {
  const db = getSqlite();
  for (const sessionId of sessionIds.splice(0)) {
    db.prepare("DELETE FROM events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  for (const projectId of projectIds.splice(0)) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("request body limits", () => {
  test("Given API routes When their body ceiling is looked up Then multipart intake is generous, draws are bounded, and JSON is small", () => {
    expect(requestBodyLimitFor("/api/design-systems/upload", "POST")).toBe(64 * MiB);
    expect(requestBodyLimitFor("/api/design-systems/abc/fonts", "POST")).toBe(64 * MiB);
    expect(requestBodyLimitFor("/api/sessions/abc/events", "POST")).toBe(64 * MiB);
    expect(requestBodyLimitFor("/api/projects/abc/draws/note", "PUT")).toBe(4 * MiB);
    expect(requestBodyLimitFor("/api/projects", "POST")).toBe(1 * MiB);
    expect(requestBodyLimitFor("/api/settings", "PATCH")).toBe(1 * MiB);
    expect(MAX_REQUEST_BODY_BYTES).toBe(64 * MiB);
  });

  test("Given an oversized JSON body with a Content-Length When posted Then the request is refused with 413 before any handler parses it", async () => {
    const app = createApp();
    const body = `{"name":"${"x".repeat(2 * MiB)}"}`;
    const response = await app.request("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("payload_too_large");
  });

  test("Given an oversized chunked body without a Content-Length When posted Then the stream is cut at the ceiling with 413", async () => {
    const app = createApp();
    const chunk = new TextEncoder().encode("x".repeat(256 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 2 * MiB) { controller.close(); return; }
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      },
    });
    const response = await app.request("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413);
  });

  test("Given a user message beyond the character ceiling When posted Then the session route rejects it with 400 and records no event", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-limits-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "index.html"), "<h1>x</h1>", "utf8");
    const { sessionId } = insertProjectWithSession(root);
    const app = createApp();
    const response = await app.request(`/api/sessions/${sessionId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "user.message", text: "a".repeat(MAX_USER_MESSAGE_CHARS + 1) }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("message_too_long");
    expect(getSqlite().query<{ count: number }, [string]>("SELECT COUNT(*) count FROM events WHERE session_id = ?").get(sessionId)?.count).toBe(0);
  });
});

describe("global turn capacity", () => {
  test("Given the configured concurrent-session ceiling When that many turns are active Then no further turn may be reserved anywhere", () => {
    const reservations = ["cap-a", "cap-b", "cap-c"].map((id) => reserveUserTurn(id));
    try {
      expect(reservations.every((reservation) => reservation !== null)).toBe(true);
      expect(hasTurnCapacity(3)).toBe(false);
      expect(hasTurnCapacity(4)).toBe(true);
    } finally {
      for (const reservation of reservations) if (reservation !== null) releaseUserTurnReservation(reservation);
    }
    expect(hasTurnCapacity(3)).toBe(true);
  });

  test("Given the default ceiling of three active turns When a fourth session posts a message Then the route answers 429 without reserving", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-capacity-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "index.html"), "<h1>x</h1>", "utf8");
    const { sessionId } = insertProjectWithSession(root);
    const reservations = ["cap-1", "cap-2", "cap-3"].map((id) => reserveUserTurn(id));
    try {
      const response = await createApp().request(`/api/sessions/${sessionId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "user.message", text: "hello" }) });
      expect(response.status).toBe(429);
      expect((await response.json()).error.code).toBe("turn_capacity_exhausted");
      // The refused request must not have left a reservation behind.
      const own = reserveUserTurn(sessionId);
      expect(own).not.toBeNull();
      if (own !== null) releaseUserTurnReservation(own);
    } finally {
      for (const reservation of reservations) if (reservation !== null) releaseUserTurnReservation(reservation);
    }
  });
});
