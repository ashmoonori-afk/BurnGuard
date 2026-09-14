import { expect, spyOn, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { createApp } from "../src/server";
import { detectBackends } from "../src/services/backends";
import { startUserTurn } from "../src/services/turns";

/**
 * Codex authentication is probed for every detection, but only Codex work depends on the answer.
 * An unrelated Codex installation that cannot be probed must leave an explicitly selected
 * Claude backend usable; the Codex entry stays indeterminate rather than confirmed logged out.
 */
test("Given an unprobeable Codex When a Claude request reaches HTTP admission and turn execution Then only the selected backend gates it", async () => {
  const projectId = `selection-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "index.html"), "<h1>Original</h1>");
  getSqlite()
    .prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','claude-code',1,1)")
    .run(projectId, projectId, projectDir);
  getSqlite()
    .prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'claude-code','idle',1,1,1)")
    .run(sessionId, projectId);

  // The selected backend answers --version; the unrelated Codex path does not exist, so its probe fails.
  const which = spyOn(Bun, "which").mockImplementation((name) =>
    name === "claude" ? process.execPath : name === "codex" ? path.join(projectDir, "missing-codex") : null,
  );
  let adapterInvoked = false;
  try {
    await expect(detectBackends({ force: true })).rejects.toMatchObject({ code: "codex_authentication_probe_failed" });
    const capability = "backend-selection-fixture";
    const app = createApp({ capability, appAuthority: "127.0.0.1:14070" });
    // Stop at body validation to exercise real HTTP admission without invoking a provider.
    for (const contentType of ["json", "multipart"] as const) {
      const headers = new Headers({ host: "127.0.0.1:14070", origin: "http://127.0.0.1:14070", "x-burnguard-capability": capability });
      let body: string | FormData;
      if (contentType === "json") {
        headers.set("content-type", "application/json");
        body = JSON.stringify({ type: "unsupported" });
      } else {
        body = new FormData();
        body.set("type", "unsupported");
      }
      const response = await app.request(`http://127.0.0.1:14070/api/sessions/${sessionId}/events`, { method: "POST", headers, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_body" } });
    }
    const turn = startUserTurn(sessionId, { type: "user.message", text: "Edit the heading" }, undefined, {
      detectBackends,
      runAdapter: async () => {
        adapterInvoked = true;
        return { exitCode: 0 };
      },
    });
    if (!turn) throw new Error("Turn reservation unavailable");
    const outcomes = await Promise.allSettled([turn.prepared, turn.promise]);
    expect(adapterInvoked).toBe(true);
    for (const outcome of outcomes) {
      expect(outcome).not.toMatchObject({ status: "rejected", reason: { code: "codex_authentication_probe_failed" } });
    }
  } finally {
    which.mockRestore();
    getSqlite().prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(projectDir, { recursive: true, force: true });
  }
});
