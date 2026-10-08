import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { ArtifactCoordinator, ArtifactOperationError } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { isTransientFilePath } from "../src/services/files";
import { ensureProjectWatcher, processProjectFilesystemSignal, scheduleProjectSignal, shouldSkipPath, shutdownProjectWatchers, startProjectWatchers } from "../src/services/watchers";
import { listProjectIds } from "../src/db/project-read-repository";
import { closeProjectWatcher, projectWatchers } from "../src/services/watcher-registry";
import { setArtifactRecoveryHold } from "../src/services/artifact-recovery-hold";
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
    await ensureProjectWatcher(item.id); await ensureProjectWatcher(item.id); await startProjectWatchers({ projectIds: [item.id] }).settled;
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

async function fixtures(count: number) {
  const items: Awaited<ReturnType<typeof fixture>>[] = [];
  for (let index = 0; index < count; index += 1) items.push(await fixture());
  return items;
}

type HeldObservation = { readonly projectId: string; readonly release: () => void; readonly fail: (error: Error) => void };

function heldObserver() {
  const started: HeldObservation[] = [];
  const waiters: { readonly count: number; readonly resolve: () => void }[] = [];
  let active = 0;
  let maxActive = 0;
  const observe = (projectId: string): Promise<void> => {
    const held = Promise.withResolvers<void>();
    active += 1; maxActive = Math.max(maxActive, active);
    started.push({ projectId, release: () => held.resolve(), fail: (error) => held.reject(error) });
    for (const waiter of waiters.filter((entry) => started.length >= entry.count)) waiter.resolve();
    return held.promise.finally(() => { active -= 1; });
  };
  const startedAtLeast = (count: number): Promise<void> => {
    if (started.length >= count) return Promise.resolve();
    const reached = Promise.withResolvers<void>();
    waiters.push({ count, resolve: reached.resolve });
    return reached.promise;
  };
  return { observe, started, startedAtLeast, maxActive: () => maxActive };
}

function writeIndex(item: { readonly id: string; readonly root: string; readonly digest: string }, bytes: string, onAdmitted: () => void = () => undefined) {
  return new ArtifactCoordinator(getSqlite()).run({ projectId: item.id, projectDir: item.root, kind: "patch", expectedRevision: 0, expectedArtifactDigest: item.digest, mutate: async (stage) => { onAdmitted(); await writeFile(path.join(stage, "index.html"), bytes); } });
}

describe("project watcher startup after the listener", () => {
  test("Given several persisted projects When watcher startup begins Then it returns before any observation settles and observes at most three projects at once", async () => {
    const items = await fixtures(5);
    const held = heldObserver();

    const startup = startProjectWatchers({ projectIds: items.map((item) => item.id), concurrency: 3, observe: held.observe });
    await held.startedAtLeast(3);

    expect(held.started.map((entry) => entry.projectId)).toEqual(items.slice(0, 3).map((item) => item.id));
    held.started[0]?.release();
    await held.startedAtLeast(4);
    expect(held.maxActive()).toBe(3);
    held.started[1]?.release(); held.started[2]?.release();
    await held.startedAtLeast(5);
    for (const entry of held.started.slice(3)) entry.release();
    await startup.settled;

    expect(held.maxActive()).toBe(3);
    expect(items.every((item) => projectWatchers.has(item.id))).toBe(true);
  });

  test("Given a project whose startup observation is pending When an artifact operation runs Then only that project's operation waits and reads are not blocked", async () => {
    const pending = await fixture();
    const other = await fixture();
    const held = heldObserver();
    const startup = startProjectWatchers({ projectIds: [pending.id], observe: held.observe });
    await held.startedAtLeast(1);
    let admitted = false;

    const waiting = writeIndex(pending, "after startup", () => { admitted = true; });
    const otherResult = await writeIndex(other, "independent");
    const files = await indexProjectFiles(pending.id);

    expect(otherResult.status).toBe("committed");
    expect(files?.map((file) => file.rel_path)).toContain("index.html");
    expect(admitted).toBe(false);
    held.started[0]?.release();
    expect((await waiting).status).toBe("committed");
    await startup.settled;
    expect(await readFile(path.join(pending.root, "index.html"), "utf8")).toBe("after startup");
  });

  test("Given a project's startup observation fails When an operation was waiting Then it gets a stable code without private detail and later operations are not blocked", async () => {
    const item = await fixture();
    const held = heldObserver();
    const startup = startProjectWatchers({ projectIds: [item.id], observe: held.observe });
    await held.startedAtLeast(1);

    const waiting = writeIndex(item, "never").catch((error: unknown) => error);
    held.started[0]?.fail(new Error("EIO: /private/user/project/index.html"));
    const failure = await waiting;
    await startup.settled;

    expect(failure).toBeInstanceOf(ArtifactOperationError);
    expect((failure as ArtifactOperationError).code).toBe("recovery_unavailable");
    expect((failure as ArtifactOperationError).message).not.toContain("/private");
    expect(projectWatchers.has(item.id)).toBe(false);
    expect((await writeIndex(item, "later")).status).toBe("committed");
  });

  test("Given a project held by startup recovery When watcher startup runs Then it is never observed or watched and its operations refuse without waiting", async () => {
    const heldProject = await fixture();
    const other = await fixture();
    const held = heldObserver();
    setArtifactRecoveryHold(getSqlite(), [heldProject.id]);
    try {
      const startup = startProjectWatchers({ projectIds: [heldProject.id, other.id], concurrency: 1, observe: held.observe });
      await held.startedAtLeast(1);

      const failure = await writeIndex(heldProject, "never").catch((error: unknown) => error);

      expect(held.started.map((entry) => entry.projectId)).toEqual([other.id]);
      expect(failure).toBeInstanceOf(ArtifactOperationError);
      expect((failure as ArtifactOperationError).code).toBe("recovery_unavailable");
      held.started[0]?.release();
      await startup.settled;
      expect(projectWatchers.has(heldProject.id)).toBe(false);
      expect(projectWatchers.has(other.id)).toBe(true);
      expect(await readFile(path.join(heldProject.root, "index.html"), "utf8")).toBe("base");
    } finally {
      setArtifactRecoveryHold(getSqlite(), []);
    }
  });

  test("Given watcher startup is in progress When shutdown stops it Then queued projects are never observed and every watcher is closed", async () => {
    const items = await fixtures(3);
    const held = heldObserver();
    const startup = startProjectWatchers({ projectIds: items.map((item) => item.id), concurrency: 1, observe: held.observe });
    await held.startedAtLeast(1);
    const queuedOperation = writeIndex(items[2]!, "during shutdown").catch((error: unknown) => error);

    const stopping = startup.stop();
    const queuedFailure = await queuedOperation;
    held.started[0]?.release();
    await stopping;

    expect(held.started.map((entry) => entry.projectId)).toEqual([items[0]!.id]);
    expect(queuedFailure).toBeInstanceOf(ArtifactOperationError);
    expect(items.some((item) => projectWatchers.has(item.id))).toBe(false);
  });

  test("Given a startup observation is pending When shutdown runs Then turns are interrupted before that observation finishes and queued projects are rejected first", async () => {
    const items = await fixtures(2);
    const held = heldObserver();
    const startup = startProjectWatchers({ projectIds: items.map((item) => item.id), concurrency: 1, observe: held.observe });
    await held.startedAtLeast(1);
    const order: string[] = [];
    const queuedOperation = writeIndex(items[1]!, "during shutdown").catch((error: unknown) => { order.push("queued rejected"); return error; });
    const interrupted = Promise.withResolvers<void>();

    const stopping = shutdownProjectWatchers(startup, async () => { await queuedOperation; order.push("turns interrupted"); interrupted.resolve(); });
    await interrupted.promise;
    order.push("observation released");
    held.started[0]?.release();
    await stopping;

    expect(order).toEqual(["queued rejected", "turns interrupted", "observation released"]);
    expect(held.started.map((entry) => entry.projectId)).toEqual([items[0]!.id]);
    expect(items.some((item) => projectWatchers.has(item.id))).toBe(false);
  });

  test("Given a project still queued for startup observation When its mutation arrives Then that project is observed next", async () => {
    const items = await fixtures(3);
    const held = heldObserver();
    const startup = startProjectWatchers({ projectIds: items.map((item) => item.id), concurrency: 1, observe: held.observe });
    await held.startedAtLeast(1);

    const waiting = writeIndex(items[2]!, "prioritized");
    held.started[0]?.release();
    await held.startedAtLeast(2);

    expect(held.started.map((entry) => entry.projectId)).toEqual([items[0]!.id, items[2]!.id]);
    held.started[1]?.release();
    expect((await waiting).status).toBe("committed");
    await held.startedAtLeast(3);
    held.started[2]?.release();
    await startup.settled;
  });

  test("Given a non-positive concurrency When watcher startup runs Then it still observes every project instead of leaving waiters pending", async () => {
    const item = await fixture();

    await startProjectWatchers({ projectIds: [item.id], concurrency: 0 }).settled;

    expect(projectWatchers.has(item.id)).toBe(true);
    expect((await writeIndex(item, "after startup")).status).toBe("committed");
  });

  test("Given backend startup When its order is inspected Then the listener and readiness line precede watcher startup and shutdown interrupts turns before waiting on watchers", async () => {
    const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    const bootstrap = await readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
    const serve = main.indexOf("Bun.serve(");
    const ready = main.indexOf("[burnguard-desktop] ${JSON.stringify({ protocol: 1, url");
    const watchersStart = main.indexOf("startProjectWatchers(");

    expect(bootstrap.includes("services/watchers")).toBe(false);
    expect(main.indexOf("await bootstrapLocalAppData()")).toBeLessThan(serve);
    expect(serve).toBeGreaterThan(0);
    expect(ready).toBeGreaterThan(serve);
    expect(watchersStart).toBeGreaterThan(ready);
    const shutdownStart = main.indexOf("const shutdown = async");
    const intakeStop = main.indexOf("server.stop(false)", shutdownStart);
    const watcherShutdown = main.indexOf("await shutdownProjectWatchers(projectWatcherStartup, async () => { await interruptAllUserTurns(); await closeActiveExportBrowsers(); })", shutdownStart);
    expect(intakeStop).toBeGreaterThan(shutdownStart);
    expect(watcherShutdown).toBeGreaterThan(intakeStop);
    expect(main.indexOf("server.stop(true)", shutdownStart)).toBeGreaterThan(watcherShutdown);
    expect(main.includes("projectWatcherStartup?.stop()")).toBe(false);
  });
});
