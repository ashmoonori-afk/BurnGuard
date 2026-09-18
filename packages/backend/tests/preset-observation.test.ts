import { expect, spyOn, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { logsDir, projectsDir } from "../src/lib/paths";
import { detectBackends } from "../src/services/backends";
import { startUserTurn } from "../src/services/turns";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";

/**
 * P1-3 observation metadata. The trace has to record which task guidance a turn actually shipped -
 * preset identity, registry version, resolution, a hash of the composed blocks and their size - so
 * a later comparison can attribute a result to a preset. It must stay a description of the
 * selection: no raw prompt text, no block text and no private filesystem paths.
 */
test("Given a completed turn When reading its trace Then the shipped preset is identified without raw prompt text", async () => {
  const projectId = `observe-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const projectDir = path.join(projectsDir, projectId);
  const tracePath = path.join(logsDir, `${sessionId}.trace.log`);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "index.html"), "<h1>Original</h1>");
  getSqlite()
    .prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','claude-code',1,1)")
    .run(projectId, projectId, projectDir);
  getSqlite()
    .prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'claude-code','idle',1,1,1)")
    .run(sessionId, projectId);

  const which = spyOn(Bun, "which").mockImplementation((name) => (name === "claude" ? process.execPath : null));
  try {
    const turn = startUserTurn(sessionId, { type: "user.message", text: "Edit the heading" }, undefined, {
      detectBackends,
      runAdapter: async () => ({ exitCode: 0 }),
      reviewDesign: async input => ({ status: "checked", repairs: 0, result: {
        schema_version: 1, project_id: input.projectId, artifact_revision: input.revision,
        artifact_digest: (await inspectCanonicalTree(input.adapter.projectDir)).tree_digest,
        created_at: Date.now(), overall_status: "ready", checks: [],
      } }),
    });
    if (!turn) throw new Error("Turn reservation unavailable");
    await Promise.allSettled([turn.prepared, turn.promise]);

    const records = (await readFile(tracePath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const built = records.find((record) => record.level === "prompt_built");
    if (!built) throw new Error("no prompt_built trace record");

    // Identity of the guidance that actually shipped, observed from the emitted envelope.
    const observed = built.task_preset as Record<string, unknown>;
    expect(observed).toBeTruthy();
    // resolveGenerationOptions resolves the unset model to the first listed Claude model, `sonnet`,
    // which takes the single alias hop to the canonical preset rather than the route default.
    expect(observed.preset_id).toBe("claude-code/native/claude-sonnet-4-6/v1");
    expect(observed.registry_version).toBe(1);
    expect(observed.model).toBe("sonnet");
    expect(observed.effort).toBe("low");
    expect(observed.size_chars).toBeGreaterThan(0);
    expect(observed.size_bytes).toBeGreaterThanOrEqual(observed.size_chars as number);
    // A stable content hash lets two runs be compared without storing the guidance itself.
    expect(observed.block_sha256).toMatch(/^[0-9a-f]{64}$/u);
    // Only the approved keys reach the trace.
    expect(Object.keys(observed).sort()).toEqual([
      "block_sha256", "effort", "model", "preset_id", "registry_version", "size_bytes", "size_chars",
    ]);

    // Redaction: the record describes the selection, never its text or the user's filesystem.
    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain("Use the brief, selected direction");
    expect(serialized).not.toContain("Edit the heading");
    expect(serialized).not.toContain(projectDir);
    expect(serialized).not.toContain("<burnguard-task-guidance-v1>");
  } finally {
    which.mockRestore();
    getSqlite().prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(projectDir, { recursive: true, force: true });
    await rm(tracePath, { force: true });
  }
});
