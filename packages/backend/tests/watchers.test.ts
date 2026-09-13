import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { isTransientFilePath } from "../src/services/files";
import { ensureAllProjectWatchers, ensureProjectWatcher, processProjectFilesystemSignal, scheduleProjectSignal, shouldSkipPath } from "../src/services/watchers";
import { listProjectIds } from "../src/db/project-read-repository";
import { closeProjectWatcher, projectWatchers } from "../src/services/watcher-registry";
import { logsDir } from "../src/lib/app-paths";
import { indexProjectFiles } from "../src/services/managed-project-files";

const roots: string[] = [];
const projects: string[] = [];
let sequence = 0;

beforeAll(async () => { await runMigrations(); });
afterEach(async () => {
  for (const project of projects.splice(0)) { closeProjectWatcher(project); getSqlite().prepare("DELETE FROM projects WHERE id=?").run(project); await rm(path.join(logsDir, `${project}-session.trace.log`), { force: true }); }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ readonly id: string; readonly root: string; readonly digest: string }> {
  sequence += 1;
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-watcher-"));
  roots.push(root);
  await writeFile(path.join(root, "index.html"), "base");
  const id = `watcher-${process.pid}-${sequence}`;
  projects.push(id);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'codex',1,1)").run(id, id, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${id}-session`, id);
  const digest = (await new ArtifactCoordinator(getSqlite()).initialize(id, root)).tree_digest;
  return { id, root, digest };
}

describe("project watcher path filtering", () => {
  test("Given coordinator-owned paths When filtering Then only managed artifact signals pass", () => {
    expect(shouldSkipPath(".index.html.123.456.tmp")).toBe(true);
    expect(shouldSkipPath(".meta/artifact-operations/op/stage/index.html")).toBe(true);
    expect(shouldSkipPath(".attachments/file")).toBe(true);
    expect(shouldSkipPath(".codex/config.toml")).toBe(true);
    expect(shouldSkipPath("nested/.CLAUDE/settings.json")).toBe(true);
    expect(shouldSkipPath("nested/.codex/config.toml")).toBe(true);
    expect(shouldSkipPath("CLAUDE.md")).toBe(true);
    expect(shouldSkipPath("nested/AGENTS.md")).toBe(true);
    expect(shouldSkipPath(".mcp.json")).toBe(true);
    expect(shouldSkipPath("index.html")).toBe(false);
    expect(isTransientFilePath(".index.html.123.456.tmp")).toBe(true);
    expect(isTransientFilePath("nested/index.html")).toBe(false);
  });

  test("Given a nested agent control directory When indexing Then neither its directory nor files appear", async () => {
    const item = await fixture();
    await mkdir(path.join(item.root, "nested", ".CoDeX"), { recursive: true });
    await writeFile(path.join(item.root, "nested", ".CoDeX", "config.toml"), "untrusted");
    await writeFile(path.join(item.root, "nested", "content.txt"), "ordinary");

    const files = await indexProjectFiles(item.id);

    expect(files?.map((file) => file.rel_path)).toContain("nested/content.txt");
    expect(files?.some((file) => file.rel_path.toLowerCase().includes(".codex"))).toBe(false);
  });

  test("Given persisted projects When watchers start Then registry ownership is idempotent and closeable", async () => {
    const item = await fixture();
    await ensureProjectWatcher(item.id); await ensureProjectWatcher(item.id); await ensureAllProjectWatchers([item.id]);
    expect(await listProjectIds()).toContain(item.id);
    expect(projectWatchers.has(item.id)).toBe(true);
    closeProjectWatcher(item.id);
    expect(projectWatchers.has(item.id)).toBe(false);
    await ensureProjectWatcher("missing-project");
  });

  test("Given watcher persistence fails When a session exists Then the exact failure is traced without retry polling", async () => {
    const item = await fixture();
    await scheduleProjectSignal(item.id, path.join(item.root, "missing"));
    const trace = await readFile(path.join(logsDir, `${item.id}-session.trace.log`), "utf8");
    expect(trace).toContain("watcher_error");
    expect(trace).toContain("Canonical tree directory is missing");
    await scheduleProjectSignal(item.id, path.join(item.root, "missing"));
  });

  test("Given an idle external write When its signal is processed Then exact bytes become one committed operation", async () => {
    const item = await fixture();
    await writeFile(path.join(item.root, "index.html"), "external");
    await processProjectFilesystemSignal(item.id, item.root);
    expect(getSqlite().query("SELECT status,result_revision FROM artifact_operations WHERE project_id=? AND json_extract(replay_json,'$.kind')!='initialize'").all(item.id)).toEqual([{ status: "committed", result_revision: 1 }]);
    expect(getSqlite().query<{ readonly current_digest: string }, [string]>("SELECT current_digest FROM projects WHERE id=?").get(item.id)?.current_digest).toBe((await inspectCanonicalTree(item.root)).tree_digest);
  });

  test("Given an external write races a working operation When its signal is processed Then stable bytes restore and both receipts conflict", async () => {
    const item = await fixture();
    getSqlite().prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) SELECT 'watch-active',project_id,'working',base_revision,base_digest,NULL,NULL,expected_revision,'','','[]',snapshot_json,retention_json,json_set(replay_json,'$.kind','turn'),created_at,updated_at FROM artifact_operations WHERE project_id=? AND json_extract(replay_json,'$.kind')='initialize'").run(item.id);
    await writeFile(path.join(item.root, "index.html"), "racing external");
    await processProjectFilesystemSignal(item.id, item.root);
    expect(await readFile(path.join(item.root, "index.html"), "utf8")).toBe("base");
    expect(getSqlite().query("SELECT status FROM artifact_operations WHERE project_id=? AND json_extract(replay_json,'$.kind')!='initialize' ORDER BY id").all(item.id)).toEqual([{ status: "conflicted" }, { status: "conflicted" }]);
  });
});
