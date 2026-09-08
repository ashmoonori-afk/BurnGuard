import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { insertSequencedEvent, listSequencedSessionEvents, parsePersistedNormalizedEvent, parsePersistedUserEvent } from "../src/db/event-sequence-repository";
import { parseJsonArray } from "../src/db/pipeline-errors";
import { subscribeBeforeBackfill } from "../src/services/sequenced-event-replay";
import { runMigrationsFrom } from "../src/db/migrate";
import type { NormalizedEvent, SequencedEventEnvelope } from "@bg/shared/events";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { diffManagedTrees, materializeManagedTree } from "../src/services/artifact-tree-storage";
import { CanonicalTreeManifestError, inspectCanonicalTree, parseCanonicalTreeManifest } from "../src/services/canonical-tree-manifest";
import { reconcileArtifactState } from "../src/services/artifact-recovery";
import { EventBroker, SequencedEventBroker } from "../src/services/broker";
import { PersistedArtifactOperationError } from "../src/services/artifact-operation-record";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

let db: Database;
let root: string;
const roots: string[] = [];

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(tmpdir(), "burnguard-session-recovery-"));
  roots.push(root);
  await writeFile(path.join(root, "index.html"), "base");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'codex',1,1)").run(root);
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
});
afterEach(async () => { db.close(); await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function projectRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "burnguard-canonical-tree-"));
  roots.push(directory);
  return directory;
}

describe("canonical managed artifact closure", () => {
  test("Given owned control directories When inspecting Then only artifact bytes contribute", async () => {
    for (const directory of [".meta", ".attachments", ".git", ".omc", ".claude"]) {
      await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, directory, "owned"), directory);
    }
    expect((await inspectCanonicalTree(root)).files.map((entry) => entry.path)).toEqual(["index.html"]);
  });

  test("Given hardlink aliases When inspecting Then aliases are rejected", async () => {
    const hardlinkRoot = await projectRoot();
    const source = path.join(hardlinkRoot, "a.txt");
    await writeFile(source, "same inode");
    await link(source, path.join(hardlinkRoot, "b.txt"));
    await expect(inspectCanonicalTree(hardlinkRoot)).rejects.toMatchObject<Partial<CanonicalTreeManifestError>>({ code: "unsafe_tree_entry" });
  });

  test.skipIf(!canCreateSymlink())(`Given symlink aliases When inspecting Then links are rejected (${SYMLINK_SKIP_REASON})`, async () => {
    const symlinkRoot = await projectRoot();
    await writeFile(path.join(symlinkRoot, "target"), "target");
    await symlink("target", path.join(symlinkRoot, "link"));
    await expect(inspectCanonicalTree(symlinkRoot)).rejects.toMatchObject<Partial<CanonicalTreeManifestError>>({ code: "unsafe_tree_entry" });
  });

  test("Given production artifact services When inventoried Then no legacy live-file patch writer or uncoordinated seed write exists", async () => {
    const sourceRoot = path.join(import.meta.dir, "../src");
    const patchSource = await readFile(path.join(sourceRoot, "services/file-patch.ts"), "utf8");
    expect(patchSource).not.toContain("patchHtmlNode(");
    expect(patchSource).not.toContain("undoLastFilePatch(");
    expect(patchSource).not.toContain("writeFile(");
    for (const relative of ["db/seed.ts", "db/seed-tutorials.ts"]) {
      const source = await readFile(path.join(sourceRoot, relative), "utf8");
      const writes = source.split("\n").filter((line) => line.includes("await writeFile("));
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every((line) => line.includes("path.join(stage,"))).toBe(true);
    }
  });

  test("Given Unicode-normalized colliding receipt paths When parsing Then ambiguity is rejected", () => {
    const files = [{ path: "é.txt", size: 1, sha256: "a".repeat(64) }, { path: "é.txt", size: 1, sha256: "b".repeat(64) }];
    const hash = createHash("sha256");
    for (const file of files) hash.update(file.path).update("\0").update(String(file.size)).update("\0").update(file.sha256).update("\n");
    expect(() => parseCanonicalTreeManifest({ schema_version: 1, digest_algorithm: "sha256", publication_state: "validated", tree_digest: hash.digest("hex"), files })).toThrow(CanonicalTreeManifestError);
  });
});

function event(id: string, text: string): NormalizedEvent {
  return { id, ts: 10, type: "chat.delta", turnId: "t", text };
}
function operationRetention(now: number): string { return JSON.stringify({ schema_version: 1, replayable: true, retained_until: now + 1_000, pruned_at: null, prune_reason: null }); }
function operationReplay(publication: "base" | "result"): string { return JSON.stringify({ schema_version: 1, kind: "turn", parent_operation_id: null, publication }); }

function insert(item: NormalizedEvent): SequencedEventEnvelope {
  const persisted = insertSequencedEvent(db, { id: item.id, sessionId: "s", direction: "down", type: item.type, payload: item, turnId: "turnId" in item ? item.turnId : null, processedAt: item.ts, createdAt: item.ts });
  return { sequence: persisted.sequence, event: item };
}

describe("sequence replay", () => {
  test("Given broker subscriptions When publishing Then unsubscribe stops both event channels", () => {
    const eventBroker = new EventBroker();
    const sequenced = new SequencedEventBroker();
    const raw: string[] = [];
    const envelopes: number[] = [];
    const stopRaw = eventBroker.subscribe("s", (item) => { raw.push(item.id); });
    const stopEnvelope = sequenced.subscribe("s", async (item) => { envelopes.push(item.sequence); });
    eventBroker.publish("s", event("a", "raw"));
    sequenced.publish("s", { sequence: 1, event: event("a", "raw") });
    stopRaw();
    stopEnvelope();
    eventBroker.publish("s", event("b", "ignored"));
    sequenced.publish("s", { sequence: 2, event: event("b", "ignored") });
    expect(raw).toEqual(["a"]);
    expect(envelopes).toEqual([1]);
  });

  test("Given every persisted event variant When decoding Then machine fields survive strict parsing", () => {
    const variants: readonly NormalizedEvent[] = [
      { id: "u", ts: 1, type: "chat.user_message", turnId: "t", text: "x", attachmentCount: 0 },
      { id: "d", ts: 1, type: "chat.delta", turnId: "t", text: "x" },
      { id: "h", ts: 1, type: "chat.thinking", turnId: "t", text: "x" },
      { id: "e", ts: 1, type: "chat.message_end", turnId: "t" },
      { id: "ts", ts: 1, type: "tool.started", turnId: "t", toolCallId: "c", tool: "Bash", input: {} },
      { id: "tf", ts: 1, type: "tool.finished", turnId: "t", toolCallId: "c", tool: "Bash", ok: true, output: {} },
      { id: "tp", ts: 1, type: "tool.permission_required", turnId: "t", toolCallId: "c", tool: "Bash", input: {} },
      { id: "a", ts: 1, type: "artifact.operation", operationId: "o", revision: 1, digest: "d", changedPaths: ["index.html"], outcome: "committed" },
      { id: "dd", ts: 1, type: "design.direction_state", state: { schema_version: 1, project_id: "p", session_id: "s", generation_id: "g", status: "loading", content_outline: ["outline"], directions: [
        { id: "editorial", order: 0, layout_key: "editorial", title: "a", summary: "a", style_facts: ["a"], status: "pending", preview_url: null, error: null },
        { id: "modular", order: 1, layout_key: "modular", title: "b", summary: "b", style_facts: ["b"], status: "pending", preview_url: null, error: null },
        { id: "narrative", order: 2, layout_key: "narrative", title: "c", summary: "c", style_facts: ["c"], status: "pending", preview_url: null, error: null },
      ], selected_id: null, selection_revision: 0, selection_history: [], error: null, updated_at: 1 } },
      { id: "f", ts: 1, type: "file.changed", turnId: "t", action: "edited", path: "index.html" },
      { id: "r", ts: 1, type: "status.running" },
      { id: "i", ts: 1, type: "status.idle", stopReason: "end_turn" },
      { id: "x", ts: 1, type: "status.error", message: "x", recoverable: true },
      { id: "g", ts: 1, type: "usage.delta", input: 1, output: 2, cached: 3 },
    ];
    expect(variants.map((item) => parsePersistedNormalizedEvent(JSON.stringify(item), item.id).type)).toEqual(variants.map((item) => item.type));
    expect(parsePersistedUserEvent('{"type":"user.interrupt"}', "u")).toEqual({ type: "user.interrupt" });
    expect(parsePersistedUserEvent('{"type":"user.message","text":"x","attachments":["a"]}', "m")).toMatchObject({ type: "user.message", attachments: ["a"] });
    expect(parsePersistedUserEvent('{"type":"user.tool_decision","toolCallId":"c","decision":"deny","reason":"x"}', "t")).toMatchObject({ type: "user.tool_decision", decision: "deny" });
    expect(parseJsonArray("[]", "array")).toEqual([]);
    expect(() => parseJsonArray("{", "bad-array")).toThrow("corrupt_json");
  });

  test("Given asynchronous broker listener failure When publishing Then delivery failure is contained", async () => {
    const eventBroker = new EventBroker();
    const sequenced = new SequencedEventBroker();
    let rejectRaw: (error: Error) => void = () => {};
    let rejectEnvelope: (error: Error) => void = () => {};
    const rawFailure = new Promise<void>((_resolve, reject) => { rejectRaw = reject; });
    const envelopeFailure = new Promise<void>((_resolve, reject) => { rejectEnvelope = reject; });
    eventBroker.subscribe("s", () => rawFailure);
    sequenced.subscribe("s", () => envelopeFailure);
    eventBroker.publish("s", event("a", "raw"));
    sequenced.publish("s", { sequence: 1, event: event("a", "raw") });
    const rawObserved = rawFailure.catch((error: Error) => error.message);
    const envelopeObserved = envelopeFailure.catch((error: Error) => error.message);
    rejectRaw(new Error("raw failure"));
    rejectEnvelope(new Error("envelope failure"));
    expect(await Promise.all([rawObserved, envelopeObserved])).toEqual(["raw failure", "envelope failure"]);
  });

  test("Given same-millisecond events When paging after sequence Then none are lost", () => {
    insert(event("z", "first"));
    insert(event("a", "second"));
    expect(listSequencedSessionEvents(db, "s", 0).map((item) => [item.sequence, item.event.id])).toEqual([[1, "z"], [2, "a"]]);
    expect(listSequencedSessionEvents(db, "s", 1).map((item) => item.event.id)).toEqual(["a"]);
  });

  test("Given an event inserted between subscribe and backfill When replay starts Then it is emitted exactly once", async () => {
    const first = insert(event("a", "first"));
    const listeners = new Set<(item: SequencedEventEnvelope) => Promise<void>>();
    const observed: SequencedEventEnvelope[] = [];
    let inserted = false;
    const stop = await subscribeBeforeBackfill({
      afterSequence: 0,
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      backfill: async (after) => {
        if (!inserted) {
          inserted = true;
          const middle = insert(event("b", "middle"));
          for (const listener of listeners) await listener(middle);
        }
        return listSequencedSessionEvents(db, "s", after);
      },
      emit: async (item) => { observed.push(item); },
    });
    const last = insert(event("c", "last"));
    for (const listener of listeners) await listener(last);
    stop();
    expect(first.sequence).toBe(1);
    expect(observed.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  test("Given Last-Event-ID When reconnecting Then only later sequences replay", () => {
    insert(event("a", "first"));
    insert(event("b", "second"));
    insert(event("c", "third"));
    expect(listSequencedSessionEvents(db, "s", 2).map((item) => item.sequence)).toEqual([3]);
  });

  test("Given a persisted running session When startup reconciles Then recovery events precede idle state", async () => {
    db.exec("UPDATE sessions SET status='running',pid=999 WHERE id='s'");
    const result = await reconcileArtifactState(db);
    expect(result.sessions).toBe(1);
    expect(db.query("SELECT status,pid FROM sessions WHERE id='s'").get()).toEqual({ status: "idle", pid: null });
    expect(listSequencedSessionEvents(db, "s", 0).map((item) => item.event.type)).toEqual(["status.error", "status.idle"]);
  });

  test("Given a fully published prepared result When startup reconciles Then commit rolls forward exactly once", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const operationId = "roll-forward-op";
    const snapshotPath = path.join(root, ".meta", "artifact-operations", operationId, "snapshot");
    const stagePath = path.join(root, ".meta", "artifact-operations", operationId, "stage");
    await materializeManagedTree(root, snapshotPath);
    await materializeManagedTree(root, stagePath);
    await writeFile(path.join(stagePath, "index.html"), "result");
    await writeFile(path.join(root, "index.html"), "result");
    const result = await inspectCanonicalTree(stagePath);
    const now = Date.now();
    db.prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES (?,'p','working',0,?,1,?,0,'','',?,?,?,?,?,?)").run(operationId, base.tree_digest, result.tree_digest, JSON.stringify(diffManagedTrees(base, result)), JSON.stringify({ schema_version: 1, snapshot_path: snapshotPath, stage_path: stagePath, base_manifest: base }), operationRetention(now), operationReplay("result"), now, now);
    await reconcileArtifactState(db);
    await reconcileArtifactState(db);
    expect(db.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 1, current_digest: result.tree_digest });
    expect(db.query("SELECT status FROM artifact_operations WHERE id=?").get(operationId)).toEqual({ status: "committed" });
  });

  test("Given partial publication and a persisted operation When startup reconciles Then base bytes restore before recovery terminalizes", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const operationId = "recover-op";
    const snapshotPath = path.join(root, ".meta", "artifact-operations", operationId, "snapshot");
    const stagePath = path.join(root, ".meta", "artifact-operations", operationId, "stage");
    await materializeManagedTree(root, snapshotPath);
    await materializeManagedTree(root, stagePath);
    await writeFile(path.join(root, "index.html"), "partial");
    const now = Date.now();
    db.prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES (?,'p','working',0,?,0,'','','[]',?,?,?,?,?)").run(operationId, base.tree_digest, JSON.stringify({ schema_version: 1, snapshot_path: snapshotPath, stage_path: stagePath, base_manifest: base }), operationRetention(now), operationReplay("base"), now, now);

    await reconcileArtifactState(db);

    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT status FROM artifact_operations WHERE id=?").get(operationId)).toEqual({ status: "recovered" });
  });

  test("Given a corrupt nonterminal operation When startup reconciles Then it fails typed before touching live bytes", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const operationId = "corrupt-op"; const now = Date.now();
    const snapshotPath = path.join(root, ".meta", "artifact-operations", operationId, "snapshot");
    const stagePath = path.join(root, ".meta", "artifact-operations", operationId, "stage");
    await materializeManagedTree(root, snapshotPath); await materializeManagedTree(root, stagePath);
    const corruptSnapshot = JSON.stringify({ schema_version: 1, snapshot_path: snapshotPath, stage_path: stagePath, base_manifest: base, unknown: true });
    db.prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES (?,'p','working',0,?,0,'','','[]',?,?,?,?,?)").run(operationId, base.tree_digest, corruptSnapshot, operationRetention(now), operationReplay("base"), now, now);
    const before = await inspectCanonicalTree(root);
    await expect(reconcileArtifactState(db)).rejects.toBeInstanceOf(PersistedArtifactOperationError);
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(before.tree_digest);
    expect(db.query("SELECT status FROM artifact_operations WHERE id=?").get(operationId)).toEqual({ status: "working" });
  });
});
