import { afterEach, expect, test } from "bun:test";
import type { BackendDetectionResult, NormalizedEvent } from "@bg/shared";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runtimeBackendProfiles } from "../src/adapters/registry";
import { getSqlite } from "../src/db/sqlite-client";
import { persistNormalizedEvent } from "../src/db/events";
import { settingsRoutes } from "../src/routes/settings";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import {
  buildRuntimeBackendDiagnostics,
  listRecentRuntimeFailures,
  resumeProjectFromSavedFiles,
} from "../src/services/runtime-diagnostics";

const db = getSqlite();
const projectIds: string[] = [];
const projectRoots: string[] = [];

afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
  }
  await Promise.all(projectRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function insertProjectSession(
  backendId: "claude-code" | "codex",
  status = "idle",
  dirPath?: string,
) {
  const projectId = `runtime-project-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  projectIds.push(projectId);
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html',?,1,1)")
    .run(projectId, "Runtime fixture", dirPath ?? `/tmp/${projectId}`, backendId);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,?,?,1,1,1)")
    .run(sessionId, projectId, backendId, status);
  return { projectId, sessionId };
}

function persist(sessionId: string, event: NormalizedEvent): void {
  persistNormalizedEvent(db, sessionId, event);
}

test("Given the adapter registry When runtime profiles are listed Then transport and capabilities match executed adapters", () => {
  const profiles = runtimeBackendProfiles();

  expect(profiles.map((profile) => [profile.id, profile.promptTransport])).toEqual([
    ["claude-code", "stdin"],
    ["codex", "stdin"],
    ["gemini", "stdin"],
    ["copilot", "saved_file"],
  ]);
  expect(profiles.find((profile) => profile.id === "codex")?.capabilities).toContain("image_generation");
  expect(profiles.filter((profile) => profile.id !== "codex").every((profile) => !profile.capabilities.includes("image_generation"))).toBe(true);
});

test("Given detected CLIs and a Codex cache timestamp When diagnostics are built Then paths stay private and model sources remain truthful", () => {
  const detection: BackendDetectionResult = {
    backends: [
      { id: "claude-code", found: true, version: "1.2.3", binary_path: "/private/bin/claude", models: [] },
      { id: "codex", found: true, version: "2.3.4", binary_path: "/private/bin/codex", models: [] },
      { id: "gemini", found: false, install_hint: "private install hint", models: [] },
      { id: "copilot", found: true, version: "3.4.5", binary_path: "/private/bin/copilot", models: [] },
    ],
  };

  const diagnostics = buildRuntimeBackendDiagnostics(detection, 1_700_000_000_000);

  expect(diagnostics.map((backend) => [backend.id, backend.model_catalog])).toEqual([
    ["claude-code", { source: "bundled", fetched_at: null }],
    ["codex", { source: "codex_cache", fetched_at: 1_700_000_000_000 }],
    ["gemini", { source: "bundled", fetched_at: null }],
    ["copilot", { source: "not_tracked", fetched_at: null }],
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain("/private/");
  expect(JSON.stringify(diagnostics)).not.toContain("install hint");
});

test("Given durable failed and interrupted turns When recent failures are derived Then only finite stages and codes leave storage", () => {
  const failed = insertProjectSession("codex");
  persist(failed.sessionId, { id: crypto.randomUUID(), ts: 10, type: "chat.user_message", turnId: "turn-failed", text: "private prompt", attachmentCount: 0 });
  persist(failed.sessionId, { id: crypto.randomUUID(), ts: 11, type: "status.error", code: "publication_failed", message: "/private/project failed", recoverable: true });
  persist(failed.sessionId, { id: crypto.randomUUID(), ts: 12, type: "status.idle", stopReason: "error" });
  const interrupted = insertProjectSession("claude-code");
  persist(interrupted.sessionId, { id: crypto.randomUUID(), ts: 20, type: "chat.user_message", turnId: "turn-interrupted", text: "private prompt", attachmentCount: 0 });
  persist(interrupted.sessionId, { id: crypto.randomUUID(), ts: 21, type: "status.idle", stopReason: "interrupted" });

  const failures = listRecentRuntimeFailures(db, 100).filter(
    (failure) => failure.project_id === failed.projectId || failure.project_id === interrupted.projectId,
  );

  expect(failures.map((failure) => [failure.turn_id, failure.stage, failure.code, failure.can_resume])).toEqual([
    ["turn-interrupted", "generation", "interrupted", true],
    ["turn-failed", "publication", "publication_failed", true],
  ]);
  expect(JSON.stringify(failures)).not.toContain("/private/");
  expect(JSON.stringify(failures)).not.toContain("private prompt");
});

test("Given saved files after a failed turn When resume is requested Then disk bytes are adopted without rerunning or rolling back", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-runtime-recovery-"));
  projectRoots.push(root);
  await writeFile(path.join(root, "index.html"), "saved-before-failure");
  const fixture = insertProjectSession("codex", "idle", root);
  await new ArtifactCoordinator(db).initialize(fixture.projectId, root);
  persist(fixture.sessionId, { id: crypto.randomUUID(), ts: 30, type: "chat.user_message", turnId: "turn-recovery", text: "continue", attachmentCount: 0 });
  persist(fixture.sessionId, { id: crypto.randomUUID(), ts: 31, type: "status.error", code: "turn_failed", message: "turn_failed", recoverable: true });
  persist(fixture.sessionId, { id: crypto.randomUUID(), ts: 32, type: "status.idle", stopReason: "error" });
  await writeFile(path.join(root, "index.html"), "saved-after-failure");

  const response = await settingsRoutes.request(`/api/settings/runtime-diagnostics/projects/${fixture.projectId}/resume`, { method: "POST" });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.data).toMatchObject({
    project_id: fixture.projectId,
    session_id: fixture.sessionId,
    status: "ready",
    artifact: { revision: 1 },
  });
  expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("saved-after-failure");
});

test("Given a successful latest turn When resume is requested Then no artifact mutation is admitted", async () => {
  const fixture = insertProjectSession("claude-code");
  persist(fixture.sessionId, { id: crypto.randomUUID(), ts: 40, type: "chat.user_message", turnId: "turn-success", text: "done", attachmentCount: 0 });
  persist(fixture.sessionId, { id: crypto.randomUUID(), ts: 41, type: "status.idle", stopReason: "end_turn" });

  await expect(resumeProjectFromSavedFiles(db, fixture.projectId)).rejects.toMatchObject({
    code: "runtime_resume_not_available",
  });
});
