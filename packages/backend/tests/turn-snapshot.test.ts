import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { hasSnapshot } from "../src/services/checkpoints";
import { startUserTurn } from "../src/services/turns";

const projectId = `turn-snapshot-${process.pid}`;
const sessionId = `${projectId}-session`;
let root = "";

beforeAll(async () => {
  await runMigrations();
  root = await mkdtemp(path.join(tmpdir(), "burnguard-turn-snapshot-"));
  await writeFile(path.join(root, "index.html"), "<html>base</html>");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(root, { recursive: true, force: true });
});

test("Given a user turn When it starts Then a pre-turn snapshot exists for the revert route", async () => {
  const started = startUserTurn(sessionId, { type: "user.message", text: "스냅샷 확인" }, undefined, {
    detectBackends: async () => ({ backends: [{ id: "codex", found: true, version: "test", binary_path: "/nonexistent/codex" }] }),
    runAdapter: async () => ({ exitCode: 0 }),
  });
  expect(started).not.toBeNull();
  await started?.promise;
  expect(await hasSnapshot(projectId, started?.turnId ?? "")).toBe(true);
});
