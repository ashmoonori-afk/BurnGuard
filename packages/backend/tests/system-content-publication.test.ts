import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { link, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCatalogRow, getCurrentSystemContent, getPendingSystemOperation, prepareCatalogOperation, getLatestCatalogOperation, listCatalogRows } from "../src/db/catalog-repository";
import { listSystemContentReceipts } from "../src/db/design-system-repository";
import { defaultManagedTreeIo, syncOpenModeFor, type ManagedTreeIo } from "../src/services/artifact-tree-storage";
import { validateCatalogReceiptTree } from "../src/services/catalog-files";
import { assertSystemContentLease, reconcileSystemContentLocks, withSystemContentAccess } from "../src/services/system-content-access";
import { contentHash, parseContentJournal, parseContentProvenance, type ContentJournal } from "../src/services/system-content-format";
import { publishSystemContent, recoverSystemContent, SYSTEM_CONTENT_BOUNDARIES, type ContentBoundary } from "../src/services/system-content-publication";
import { contentPaths, inspectContentTree, pathStat } from "../src/services/system-content-tree";
import { buildExtractionProvenance } from "../src/services/extraction-provenance";
import { createInput, environment, expectedDigest, expectedDigestTraces, fixture, NEW_RULES, OLD_RULES, OPERATION_ID, rulesAdapter } from "./fixtures/system-content-fixture";

const roots: string[] = [];
const databases: Database[] = [];
async function setup(mode: "replace" | "create" = "replace") {
  const root = await mkdtemp(path.join(tmpdir(), "bg-system-content-"));
  roots.push(root);
  const f = await fixture(root, mode);
  databases.push(f.db);
  return f;
}
afterEach(async () => {
  if (expectedDigestTraces.size > 0) process.stderr.write(`SYSTEM_CONTENT_PENDING_TRACE ${JSON.stringify([...expectedDigestTraces])}\n`);
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Event deadline exceeded")), 20_000); })]); }
  finally { clearTimeout(timer); }
}
async function save(f: Awaited<ReturnType<typeof setup>>, mode: "replace" | "create" = "replace", atBoundary?: (name: ContentBoundary) => Promise<void>, io?: ManagedTreeIo) {
  const env = environment(f.db, f.systemsRoot);
  return publishSystemContent({ ...env, ...(atBoundary === undefined ? {} : { atBoundary }), ...(io === undefined ? {} : { io }) },
    { systemId: "test-system", mode, expectedDigest: await expectedDigest(env), adapter: rulesAdapter(), ...createInput(mode) });
}
describe("system content publication", () => {
  test("Given retained native publication statements When the owned file database closes Then no SQLite statement remains open", async () => {
    const prepared = spyOn(Database.prototype, "prepare");
    try {
      const f = await setup();
      await save(f);
      expect(() => f.db.close(true)).not.toThrow();
    } finally {
      try {
        for (const result of prepared.mock.results) if (result.type === "return") result.value.finalize();
      } finally {
        prepared.mockRestore();
      }
    }
  });
  test("Given an installed full tree When publication commits Then excluded bytes empty directories and CRLF survive", async () => {
    const f = await setup();
    const before = await inspectContentTree(f.live);
    const result = await save(f);
    expect(result.receipt?.schemaVersion).toBe(2);
    expect(result.receipt?.contentRevision).toBe(1);
    expect(result.receipt?.status).toBe("committed");
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(NEW_RULES);
    expect(await readFile(path.join(f.live, "README.md"), "utf8")).toBe("installed\r\n");
    expect(await readFile(path.join(f.live, ".git/payload"))).toEqual(Buffer.from([0, 1, 255, 13, 10]));
    expect(await readdir(path.join(f.live, ".git/empty"))).toEqual([]);
    expect(await readdir(path.join(f.live, "empty"))).toEqual([]);
    expect(result.observation.tree?.manifest.tree_digest).not.toBe(before.manifest.tree_digest);
    expect(getCurrentSystemContent(f.db, "test-system")?.id).toBe(result.receipt?.id);
    expect(getPendingSystemOperation(f.db, "test-system")).toBeNull();
    const journal = parseContentJournal(JSON.parse(result.receipt?.metadataJson ?? "null"));
    expect(journal.cleanup).toBe("complete");
    expect(journal.write_set).toEqual(["rules.json"]);
    if (result.receipt === null) throw new Error("Missing receipt");
    await expect(validateCatalogReceiptTree(f.live, result.receipt)).resolves.toBeDefined();
  });
  test("Given an unchanged generated tree When saved again Then no revision or history is appended", async () => {
    const f = await setup();
    await save(f);
    const env = { ...environment(f.db, f.systemsRoot), operationId: () => "22222222-2222-4222-8222-222222222222" };
    const result = await publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: await expectedDigest(env), adapter: rulesAdapter() });
    expect(result.noOp).toBe(true);
    expect(listSystemContentReceipts(f.db)).toHaveLength(1);
  });
  test("Given two callers with the same actual digest When queued together Then exactly one commits and stale authority fails", async () => {
    const f = await setup();
    const env = environment(f.db, f.systemsRoot);
    const expected = await expectedDigest(env);
    const results = await Promise.allSettled([1, 2].map(() => publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: expected, adapter: rulesAdapter() })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason.code : null).toBe("expected_digest_conflict");
    expect(listSystemContentReceipts(f.db)).toHaveLength(1);
  });
  test("Given a paused leased read When publication queues Then old materialized bytes precede complete new bytes", async () => {
    const f = await setup();
    const env = environment(f.db, f.systemsRoot);
    const expected = await expectedDigest(env);
    const acquired = deferred();
    const release = deferred();
    const oldRead = withSystemContentAccess(f.db, f.systemsRoot, ["test-system"], async () => {
      const bytes = await readFile(path.join(f.live, "rules.json"));
      acquired.resolve();
      await release.promise;
      return bytes.toString("utf8");
    });
    await bounded(acquired.promise);
    const writing = publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: expected, adapter: rulesAdapter() });
    release.resolve();
    expect(await bounded(oldRead)).toBe(OLD_RULES);
    await bounded(writing);
    const next = await withSystemContentAccess(f.db, f.systemsRoot, ["test-system"], () => readFile(path.join(f.live, "rules.json"), "utf8"));
    expect(next).toBe(NEW_RULES);
  });
  test.each(["metadata", "disk", "excluded"] as const)("Given stale %s authority When prepare would begin Then no receipt is prepared", async (kind) => {
    const f = await setup();
    const env = environment(f.db, f.systemsRoot);
    const expected = await expectedDigest(env);
    if (kind === "metadata") f.db.run("UPDATE design_systems SET metadata_revision=metadata_revision+1");
    else await writeFile(path.join(f.live, kind === "disk" ? "README.md" : ".git/payload"), "external");
    await expect(publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: expected, adapter: rulesAdapter() })).rejects.toMatchObject({ code: "expected_digest_conflict" });
    expect(listSystemContentReceipts(f.db)).toHaveLength(0);
  });
  test("Given an adapter writing an undeclared excluded file When staged Then the installed tree is unchanged", async () => {
    const f = await setup();
    const env = environment(f.db, f.systemsRoot);
    const before = await inspectContentTree(f.live);
    const adapter = rulesAdapter();
    await expect(publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: await expectedDigest(env),
      adapter: { ...adapter, transform: async (stage, base, boundary) => { await adapter.transform(stage, base, boundary); await writeFile(path.join(stage, ".git/payload"), "lost"); } } })).rejects.toMatchObject({ code: "system_content_conflict" });
    expect((await inspectContentTree(f.live)).preservation_digest).toBe(before.preservation_digest);
    expect(listSystemContentReceipts(f.db)).toHaveLength(0);
  });
  test.each(["base", "candidate", "restore"] as const)("Given a %s rename fault When rollback executes Then the only old tree is retained", async (phase) => {
    const f = await setup();
    let calls = 0;
    const io: ManagedTreeIo = { ...defaultManagedTreeIo, rename: async (from, to) => {
      calls += 1;
      if (phase === "base" && calls === 1 || phase === "candidate" && calls === 2 || phase === "restore" && (calls === 2 || calls === 3)) throw new Error("rename_fault");
      await defaultManagedTreeIo.rename(from, to);
    } };
    await expect(save(f, "replace", undefined, io)).rejects.toBeDefined();
    const env = environment(f.db, f.systemsRoot);
    const paths = await contentPaths(f.systemsRoot, "test-system", OPERATION_ID);
    if (phase === "restore") {
      expect(getPendingSystemOperation(f.db, "test-system")).not.toBeNull();
      expect(await readFile(path.join(paths.previous, "rules.json"), "utf8")).toBe(OLD_RULES);
      expect((await recoverSystemContent(env)).held).toEqual([]);
    }
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
    expect(getCurrentSystemContent(f.db, "test-system")).toBeNull();
    expect(listSystemContentReceipts(f.db)[0]?.status).toBe("failed");
    await expect(recoverSystemContent(env)).resolves.toMatchObject({ held: [] });
  });
  test("Given a failed positive revision When the next publication succeeds Then revision allocation remains monotonic", async () => {
    const f = await setup();
    await expect(save(f, "replace", async (name) => { if (name === "before-commit") throw new Error("commit_boundary_fault"); })).rejects.toBeDefined();
    const env = { ...environment(f.db, f.systemsRoot), operationId: () => "22222222-2222-4222-8222-222222222222" };
    const result = await publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: await expectedDigest(env), adapter: rulesAdapter() });
    expect(result.receipt?.contentRevision).toBe(2);
    expect(listSystemContentReceipts(f.db).map((receipt) => receipt.status)).toEqual(["failed", "committed"]);
  });
  test.each(["prepare", "commit", "rollback-intent"] as const)("Given a SQLite %s fault When publication runs Then durable SQL decides recovery", async (phase) => {
    const f = await setup();
    const sql = phase === "prepare"
      ? "CREATE TRIGGER injected_sql BEFORE INSERT ON design_system_receipts BEGIN SELECT RAISE(ABORT,'prepare_fault'); END"
      : `CREATE TRIGGER injected_sql BEFORE UPDATE ON design_system_receipts WHEN ${phase === "commit" ? "NEW.status='committed'" : "json_extract(NEW.metadata_json,'$.intent')='rollback'"} BEGIN SELECT RAISE(ABORT,'transition_fault'); END`;
    f.db.run(sql);
    await expect(save(f, "replace", phase === "rollback-intent" ? async (name) => { if (name === "before-commit") throw new Error("publication_fault"); } : undefined)).rejects.toBeDefined();
    if (phase === "rollback-intent") {
      const pending = getPendingSystemOperation(f.db, "test-system");
      expect(pending).not.toBeNull();
      expect(parseContentJournal(JSON.parse(pending?.metadataJson ?? "null")).intent).toBe("publish");
      expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(NEW_RULES);
    } else {
      expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
      expect(getCurrentSystemContent(f.db, "test-system")).toBeNull();
    }
    f.db.run("DROP TRIGGER injected_sql");
    const recovered = await recoverSystemContent(environment(f.db, f.systemsRoot));
    expect(recovered.held).toEqual([]);
    if (phase === "rollback-intent") expect(getCurrentSystemContent(f.db, "test-system")?.status).toBe("committed");
    else expect(listSystemContentReceipts(f.db).map((receipt) => receipt.status)).toEqual(phase === "prepare" ? [] : ["failed"]);
  });
  test.each([1, 2, 3, 4])("Given flush call %s fails When staging runs Then live stays old and owned leftovers recover", async (faultCall) => {
    const f = await setup();
    let calls = 0;
    const io: ManagedTreeIo = { ...defaultManagedTreeIo, syncFile: async (handle) => {
      if (++calls === faultCall) throw new Error("file_sync_fault");
      await defaultManagedTreeIo.syncFile(handle);
    } };
    await expect(save(f, "replace", undefined, io)).rejects.toBeDefined();
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
    expect(listSystemContentReceipts(f.db)).toHaveLength(0);
    expect((await recoverSystemContent(environment(f.db, f.systemsRoot))).held).toEqual([]);
  });
  test.each(["base-parent", "candidate-parent"] as const)("Given %s sync fails after its rename When caught Then rollback proves restoration", async (phase) => {
    const f = await setup();
    let armed = false;
    let failed = false;
    const io: ManagedTreeIo = { ...defaultManagedTreeIo, syncDirectory: async (directory) => {
      if (armed && !failed) { failed = true; throw new Error("parent_sync_fault"); }
      await defaultManagedTreeIo.syncDirectory(directory);
    } };
    await expect(save(f, "replace", async (name) => {
      if (name === (phase === "base-parent" ? "base-moved" : "candidate-moved")) armed = true;
    }, io)).rejects.toBeDefined();
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
    expect(listSystemContentReceipts(f.db)[0]?.status).toBe("failed");
  });
  test("Given cleanup fails after commit When the caller returns Then success stays committed and cleanup retries", async () => {
    const f = await setup();
    const result = await save(f, "replace", async (name) => { if (name === "before-backup-remove") throw new Error("cleanup_fault"); });
    expect(result.receipt?.status).toBe("committed");
    expect(parseContentJournal(JSON.parse(result.receipt?.metadataJson ?? "null")).cleanup).toBe("pending");
    expect(await pathStat((await contentPaths(f.systemsRoot, "test-system", OPERATION_ID)).previous)).not.toBeNull();
    expect((await recoverSystemContent(environment(f.db, f.systemsRoot))).held).toEqual([]);
    expect((await recoverSystemContent(environment(f.db, f.systemsRoot))).held).toEqual([]);
  });
  test.each(["missing", "changed"] as const)("Given a cleaned committed head is %s When recovery runs Then its authority is held without replacing bytes", async (kind) => {
    const f = await setup();
    const result = await save(f);
    if (result.receipt === null) throw new Error("Missing receipt");
    if (kind === "missing") await rm(f.live, { recursive: true });
    else await writeFile(path.join(f.live, "rules.json"), "external-after-cleanup");
    const env = environment(f.db, f.systemsRoot);
    expect((await recoverSystemContent(env)).held).toEqual([result.receipt.id]);
    expect((await recoverSystemContent(env)).held).toEqual([result.receipt.id]);
    expect(getCurrentSystemContent(f.db, "test-system")?.id).toBe(result.receipt.id);
    expect(getCurrentSystemContent(f.db, "test-system")?.status).toBe("committed");
    if (kind === "missing") expect(await pathStat(f.live)).toBeNull();
    else expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe("external-after-cleanup");
  });
  test("Given excluded bytes change after a cleaned committed head When recovery runs Then canonical authority and authored bytes survive", async () => {
    const f = await setup();
    await save(f);
    await writeFile(path.join(f.live, ".git/payload"), "later-excluded-edit");
    expect((await recoverSystemContent(environment(f.db, f.systemsRoot))).held).toEqual([]);
    expect(await readFile(path.join(f.live, ".git/payload"), "utf8")).toBe("later-excluded-edit");
  });
  test("Given two cleaned committed heads When recovery runs Then only the current tree is validated", async () => {
    const f = await setup();
    await save(f);
    const newer = '{"rules":["newer"]}\n';
    const validate = async (root: string) => {
      if (await readFile(path.join(root, "rules.json"), "utf8") !== newer) throw new Error("candidate_invalid");
    };
    const env = { ...environment(f.db, f.systemsRoot), operationId: () => "22222222-2222-4222-8222-222222222222", validators: { rules: validate } };
    const adapter: ReturnType<typeof rulesAdapter> = {
      ...rulesAdapter(), validate, transform: async (stage) => { await writeFile(path.join(stage, "rules.json"), newer); },
    };
    const result = await publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: await expectedDigest(env), adapter });
    expect(result.receipt?.contentRevision).toBe(2);
    expect((await recoverSystemContent(env)).held).toEqual([]);
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(newer);
  });
  test("Given commit wins but its caller throws When outcome is reread Then committed content cannot roll back", async () => {
    const f = await setup();
    let observedCommitted = false;
    const result = await save(f, "replace", async (name) => {
      if (name === "before-commit") expect(getCurrentSystemContent(f.db, "test-system")).toBeNull();
      if (name === "receipt-committed") {
        observedCommitted = getCurrentSystemContent(f.db, "test-system")?.status === "committed";
        throw new Error("response_lost");
      }
    });
    expect(observedCommitted).toBe(true);
    expect(result.receipt?.status).toBe("committed");
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(NEW_RULES);
  });
  test("Given a pending create When normal catalog rows are listed Then the reserved row remains hidden until commit", async () => {
    const f = await setup("create");
    let reserved = false;
    const result = await save(f, "create", async (name) => {
      if (name === "receipt-prepared") {
        reserved = getCatalogRow(f.db, "test-system") !== null;
        expect(listCatalogRows(f.db)).toEqual([]);
      }
    });
    expect(reserved).toBe(true);
    expect(result.receipt?.status).toBe("committed");
    expect(listCatalogRows(f.db).map((row) => row.id)).toEqual(["test-system"]);
  });
  test("Given creation removal is blocked When rollback storage is cleaned Then durable ownership remains until atomic removal succeeds", async () => {
    const f = await setup("create");
    f.db.run("CREATE TRIGGER block_create_removal BEFORE DELETE ON design_systems BEGIN SELECT RAISE(ABORT,'delete_fault'); END");
    await expect(save(f, "create", async (name) => {
      if (name === "candidate-validated") throw new Error("rollback_create");
    })).rejects.toBeDefined();
    expect(await pathStat(f.live)).toBeNull();
    expect(getPendingSystemOperation(f.db, "test-system")?.id).toBe(`system-content-${OPERATION_ID}`);
    expect(listCatalogRows(f.db)).toEqual([]);
    await expect(withSystemContentAccess(f.db, f.systemsRoot, ["test-system"], async () => null))
      .rejects.toMatchObject({ code: "system_content_unavailable" });
    const env = environment(f.db, f.systemsRoot);
    expect((await recoverSystemContent(env)).held).toEqual([`system-content-${OPERATION_ID}`]);
    expect((await recoverSystemContent(env)).held).toEqual([`system-content-${OPERATION_ID}`]);
    f.db.run("DROP TRIGGER block_create_removal");
    expect((await recoverSystemContent(env)).held).toEqual([]);
    expect((await recoverSystemContent(env)).held).toEqual([]);
    expect(getCatalogRow(f.db, "test-system")).toBeNull();
    expect(listSystemContentReceipts(f.db)).toEqual([]);
    expect(getPendingSystemOperation(f.db, "test-system")).toBeNull();
  });
  test("Given metadata changes after preparation When commit checks authority Then both trees remain held", async () => {
    const f = await setup();
    await expect(save(f, "replace", async (name) => {
      if (name === "before-commit") f.db.run("UPDATE design_systems SET metadata_revision=1");
    })).rejects.toMatchObject({ code: "system_content_conflict" });
    expect(getCurrentSystemContent(f.db, "test-system")).toBeNull();
    expect(getPendingSystemOperation(f.db, "test-system")).not.toBeNull();
    const paths = await contentPaths(f.systemsRoot, "test-system", OPERATION_ID);
    expect(await readFile(path.join(paths.previous, "rules.json"), "utf8")).toBe(OLD_RULES);
    expect(await readFile(path.join(paths.live, "rules.json"), "utf8")).toBe(NEW_RULES);
    expect((await recoverSystemContent(environment(f.db, f.systemsRoot))).held).toEqual([`system-content-${OPERATION_ID}`]);
  });
  test("Given an excluded payload exceeds the whole copy budget When observed Then no candidate or receipt is created", async () => {
    const f = await setup();
    const handle = await open(path.join(f.live, ".git/large"), "wx");
    try { await handle.truncate(128 * 1024 * 1024 + 1); } finally { await handle.close(); }
    await expect(expectedDigest(environment(f.db, f.systemsRoot))).rejects.toMatchObject({ code: "system_content_conflict" });
    expect(listSystemContentReceipts(f.db)).toHaveLength(0);
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
  });
  test("Given decomposed disk spelling When the full tree is copied Then bytes and spelling stay identical", async () => {
    const f = await setup();
    await writeFile(path.join(f.live, "cafe\u0301.txt"), "raw\r\n");
    const before = (await inspectContentTree(f.live)).inventory.find((entry) => entry[1].normalize("NFC") === "caf\u00e9.txt");
    await save(f);
    const after = (await inspectContentTree(f.live)).inventory.find((entry) => entry[1].normalize("NFC") === "caf\u00e9.txt");
    expect(after).toEqual(before);
  });
  test("Given an unsafe lock root When access rejects Then correcting it releases the next queued caller", async () => {
    const f = await setup();
    const outside = path.join(path.dirname(f.dbPath), "lock-target");
    const lockRoot = path.join(f.systemsRoot, ".catalog-locks");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "preserve");
    await symlink(outside, lockRoot, process.platform === "win32" ? "junction" : "dir");
    await expect(withSystemContentAccess(f.db, f.systemsRoot, ["test-system"], async () => "unsafe"))
      .rejects.toMatchObject({ code: "system_content_conflict" });
    await rm(lockRoot, { recursive: true });
    await expect(bounded(withSystemContentAccess(f.db, f.systemsRoot, ["test-system"], async () => "read-ready")))
      .resolves.toBe("read-ready");
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("preserve");
  });
  test("Given a sorted multi-system lease When a nested helper uses it Then forged and expired leases fail", async () => {
    const f = await setup();
    let checkExpired = () => {};
    await withSystemContentAccess(f.db, f.systemsRoot, ["z-system", "test-system", "z-system"], async (lease) => {
      expect(lease.systemIds).toEqual(["test-system", "z-system"]);
      assertSystemContentLease(lease, f.systemsRoot, "test-system");
      expect(() => assertSystemContentLease({ systemIds: ["test-system"] }, f.systemsRoot, "test-system")).toThrow();
      checkExpired = () => assertSystemContentLease(lease, f.systemsRoot, "test-system");
    });
    expect(checkExpired).toThrow();
  });
  test.each(["backup", "candidate", "owner"] as const)("Given divergent %s bytes When rollback and recovery inspect them Then evidence is held unchanged", async (kind) => {
    const f = await setup();
    const paths = await contentPaths(f.systemsRoot, "test-system", OPERATION_ID);
    await expect(save(f, "replace", async (name) => {
      if (name !== (kind === "backup" ? "base-moved" : "candidate-moved")) return;
      if (kind === "owner") await writeFile(paths.owner, '{"version":1,"operation_id":"wrong","system_id":"test-system"}');
      else await writeFile(path.join(kind === "backup" ? paths.previous : paths.live, "rules.json"), "external-unknown");
      throw new Error("external_edit");
    })).rejects.toBeDefined();
    const env = environment(f.db, f.systemsRoot);
    expect((await recoverSystemContent(env)).held).toContain(`system-content-${OPERATION_ID}`);
    expect((await recoverSystemContent(env)).held).toContain(`system-content-${OPERATION_ID}`);
    expect(getPendingSystemOperation(f.db, "test-system")).not.toBeNull();
    if (kind !== "owner") expect(await readFile(path.join(kind === "backup" ? paths.previous : paths.live, "rules.json"), "utf8")).toBe("external-unknown");
    await expect(withSystemContentAccess(f.db, f.systemsRoot, ["test-system"], async () => null)).rejects.toMatchObject({ code: "system_content_unavailable" });
  });
  test.each(["journal", "destination", "parent", "provenance"] as const)("Given tampered persisted %s When recovery reopens Then no unknown evidence is adopted", async (kind) => {
    const f = await setup();
    f.db.run("CREATE TRIGGER rollback_block BEFORE UPDATE ON design_system_receipts WHEN json_extract(NEW.metadata_json,'$.intent')='rollback' BEGIN SELECT RAISE(ABORT,'rollback_block'); END");
    await expect(save(f, "replace", async (name) => { if (name === "before-commit") throw new Error("stop_before_commit"); })).rejects.toBeDefined();
    f.db.run("DROP TRIGGER rollback_block");
    const pending = getPendingSystemOperation(f.db, "test-system");
    if (pending === null) throw new Error("Missing pending receipt");
    const journal = parseContentJournal(JSON.parse(pending.metadataJson));
    if (kind === "journal") f.db.query("UPDATE design_system_receipts SET metadata_json=? WHERE id=?").run(JSON.stringify({ ...journal, unknown: true }), pending.id);
    if (kind === "destination") f.db.query("UPDATE design_system_receipts SET destination_path=? WHERE id=?").run(path.join(path.dirname(f.systemsRoot), "outside"), pending.id);
    if (kind === "parent") f.db.query("UPDATE design_system_receipts SET parent_digest=? WHERE id=?").run(contentHash("other"), pending.id);
    if (kind === "provenance") f.db.query("UPDATE design_system_receipts SET provenance_json=? WHERE id=?").run(JSON.stringify({ format: "system-content-v1", writer: "rules", source_extraction: null, unknown: true }), pending.id);
    const env = environment(f.db, f.systemsRoot);
    expect((await recoverSystemContent(env)).held).toEqual([pending.id]);
    expect((await recoverSystemContent(env)).held).toEqual([pending.id]);
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(NEW_RULES);
    const paths = await contentPaths(f.systemsRoot, "test-system", OPERATION_ID);
    expect(await readFile(path.join(paths.previous, "rules.json"), "utf8")).toBe(OLD_RULES);
    expect(getCurrentSystemContent(f.db, "test-system")).toBeNull();
  });
  test("Given committed storage diverges before cleanup When recovery runs Then committed authority never restores its old backup", async () => {
    const f = await setup();
    await save(f, "replace", async (name) => { if (name === "before-backup-remove") throw new Error("leave_backup"); });
    await writeFile(path.join(f.live, "rules.json"), "external-after-commit");
    const env = environment(f.db, f.systemsRoot);
    expect((await recoverSystemContent(env)).held).toEqual([`system-content-${OPERATION_ID}`]);
    expect((await recoverSystemContent(env)).held).toEqual([`system-content-${OPERATION_ID}`]);
    expect(getCurrentSystemContent(f.db, "test-system")?.status).toBe("committed");
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe("external-after-commit");
    const paths = await contentPaths(f.systemsRoot, "test-system", OPERATION_ID);
    expect(await readFile(path.join(paths.previous, "rules.json"), "utf8")).toBe(OLD_RULES);
  });
  test.each(["missing", "divergent"] as const)("Given a %s stage after the base move When recovery resumes Then old bytes return without deleting unknown content", async (kind) => {
    const f = await setup();
    f.db.run("CREATE TRIGGER rollback_block BEFORE UPDATE ON design_system_receipts WHEN json_extract(NEW.metadata_json,'$.intent')='rollback' BEGIN SELECT RAISE(ABORT,'rollback_block'); END");
    await expect(save(f, "replace", async (name) => { if (name === "base-moved") throw new Error("stop_after_base_move"); })).rejects.toBeDefined();
    f.db.run("DROP TRIGGER rollback_block");
    const paths = await contentPaths(f.systemsRoot, "test-system", OPERATION_ID);
    if (kind === "missing") await rm(paths.stage, { recursive: true });
    else await writeFile(path.join(paths.stage, "rules.json"), "unknown-stage");
    const env = environment(f.db, f.systemsRoot);
    const first = await recoverSystemContent(env);
    const second = await recoverSystemContent(env);
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
    expect(getCurrentSystemContent(f.db, "test-system")).toBeNull();
    if (kind === "missing") {
      expect(first.held).toEqual([]);
      expect(second.held).toEqual([]);
      expect(listSystemContentReceipts(f.db)[0]?.status).toBe("failed");
    } else {
      expect(first.held).toEqual([`system-content-${OPERATION_ID}`]);
      expect(second.held).toEqual([`system-content-${OPERATION_ID}`]);
      expect(await readFile(path.join(paths.stage, "rules.json"), "utf8")).toBe("unknown-stage");
      expect(getPendingSystemOperation(f.db, "test-system")).not.toBeNull();
    }
  });
  test("Given v1 extraction authority When v2 authors and lifecycle prepares Then historical digest and sidecar semantics stay immutable", async () => {
    const f = await setup();
    const extraction = buildExtractionProvenance([], 1);
    const rawSidecar = JSON.stringify(extraction);
    await mkdir(path.join(f.live, "fonts"));
    await writeFile(path.join(f.live, "fonts/fonts.css"), ":root {}\r\n");
    await writeFile(path.join(f.live, "colors_and_type.css"), ":root {}\r\n");
    await writeFile(path.join(f.live, "SKILL.md"), "---\nname: fixture\n---\n");
    await writeFile(path.join(f.live, "extraction-provenance.json"), rawSidecar);
    const tree = await inspectContentTree(f.live);
    f.db.query(`INSERT INTO design_system_receipts(id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at)
      VALUES ('extraction','test-system','committed',1,1,?,?,?,1,1)`).run(extraction.content_digest, JSON.stringify(tree.manifest), rawSidecar);
    const old = getCurrentSystemContent(f.db, "test-system");
    const env = environment(f.db, f.systemsRoot);
    const adapter = rulesAdapter();
    const result = await publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: await expectedDigest(env),
      adapter: { ...adapter, provenance: { ...adapter.provenance, source_extraction: { receipt_id: "extraction", digest: extraction.content_digest } } } });
    expect(await readFile(path.join(f.live, "extraction-provenance.json"), "utf8")).toBe(rawSidecar);
    expect(f.db.query("SELECT digest,manifest_json,provenance_json,schema_version FROM design_system_receipts WHERE id='extraction'").get()).toEqual({
      digest: old?.digest, manifest_json: old?.manifestJson, provenance_json: old?.provenanceJson, schema_version: 1,
    });
    const current = result.receipt;
    if (current === null) throw new Error("Missing content receipt");
    expect(current.parentReceiptId).toBe("extraction");
    expect(current.parentDigest).toBe(extraction.content_digest);
    expect(current.digest).not.toBe(extraction.content_digest);
    const lifecycleId = prepareCatalogOperation(f.db, { systemId: "test-system", operation: "trash", digest: current.digest, manifestJson: current.manifestJson,
      provenanceJson: current.provenanceJson, parentSystemId: "test-system", parentReceiptId: current.id, parentDigest: current.digest,
      reason: null, metadata: {}, sourcePath: f.live, destinationPath: path.join(f.systemsRoot, ".catalog-trash/test-system"), now: 20 });
    const lifecycle = getPendingSystemOperation(f.db, "test-system");
    expect(lifecycle?.id).toBe(lifecycleId);
    expect(lifecycle?.schemaVersion).toBe(2);
    expect(lifecycle?.metadataJson).toBe("{}");
    expect(getLatestCatalogOperation(f.db, "test-system", "trash")).toBeNull();
    await expect(validateCatalogReceiptTree(f.live, { ...current, schemaVersion: 99 })).rejects.toMatchObject({ code: "catalog_manifest_unverifiable" });
  });
});

const rollbackBoundaries = ["rollback-intent-recorded", "candidate-discarded", "base-restored", "rollback-recorded"] as const;
const beforePrepare = ["owner-created", "stage-state-written", "stage-css-written", "stage-validated", "stage-synced"];
for (const mode of ["replace", "create"] as const) {
  const boundaries = SYSTEM_CONTENT_BOUNDARIES.filter((name) =>
    mode === "replace" || !["base-moved", "base-parent-synced", "base-restored", "before-backup-remove", "backup-removed"].includes(name));
  const scenarios = [
    ...boundaries.map((target) => [target, false] as const),
    ...(mode === "create" ? [["cleanup-recorded", true] as const] : []),
  ];
  describe(`real process recovery ${mode}`, () => {
    test.each(scenarios)("Given a process exit at %s with forced rollback=%s When fresh recovery runs twice Then the durable intent wins", async (target, forcedRollback) => {
      const f = await setup(mode);
      f.db.close();
      databases.splice(databases.indexOf(f.db), 1);
      const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/system-content-recovery-probe.ts"), f.dbPath, f.systemsRoot, mode, target, ...(forcedRollback ? ["rollback"] : [])],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, BG_APP_ROOT: path.join(path.dirname(f.dbPath), "isolated-profile") } });
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      const exit = child.exited;
      child.stdin.write("go\n");
      child.stdin.end();
      let result: [string, string, number];
      try { result = await bounded(Promise.all([stdout, stderr, exit])); }
      finally { if (child.exitCode === null) child.kill(); await child.exited; }
      expect(result[2], result[1]).toBe(73);
      expect(result[0]).toBe(`BOUNDARY ${target}\n`);
      const db = new Database(f.dbPath);
      databases.push(db);
      db.run("PRAGMA foreign_keys=ON");
      const env = environment(db, f.systemsRoot);
      await reconcileSystemContentLocks(db, f.systemsRoot);
      expect((await recoverSystemContent(env)).held).toEqual([]);
      expect((await recoverSystemContent(env)).held).toEqual([]);
      const rolledBack = forcedRollback || rollbackBoundaries.some((name) => name === target);
      const published = !beforePrepare.includes(target) && !rolledBack;
      const receipt = listSystemContentReceipts(db)[0];
      if (published) {
        expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(NEW_RULES);
        expect(receipt?.status).toBe("committed");
        expect(getCurrentSystemContent(db, "test-system")?.id).toBe(receipt?.id);
        expect(parseContentJournal(JSON.parse(receipt?.metadataJson ?? "null")).cleanup).toBe("complete");
      } else {
        expect(getCurrentSystemContent(db, "test-system")).toBeNull();
        if (mode === "replace") {
          expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
          if (rolledBack) expect(receipt?.status).toBe("failed");
          else expect(receipt).toBeUndefined();
        } else {
          expect(await pathStat(f.live)).toBeNull();
          expect(getCatalogRow(db, "test-system")).toBeNull();
          expect(receipt).toBeUndefined();
        }
      }
      if (mode === "replace") {
        expect(await readFile(path.join(f.live, ".git/payload"))).toEqual(Buffer.from([0, 1, 255, 13, 10]));
        expect(await readdir(path.join(f.live, "empty"))).toEqual([]);
      }
      expect(getPendingSystemOperation(db, "test-system")).toBeNull();
      expect(await pathStat((await contentPaths(f.systemsRoot, "test-system", OPERATION_ID)).control)).toBeNull();
    });
  });
}

describe("strict persisted evidence and paths", () => {
  test.each(["../escape", "C:\\escape", "\\\\host\\share", "a\\b", "/absolute", "NUL", "a/../b"])("Given unsafe path %s When an adapter declares it Then live bytes survive", async (name) => {
    const f = await setup();
    const env = environment(f.db, f.systemsRoot);
    await expect(publishSystemContent(env, { systemId: "test-system", mode: "replace", expectedDigest: await expectedDigest(env), adapter: { ...rulesAdapter(), writeSet: () => [name] } })).rejects.toBeDefined();
    expect(await readFile(path.join(f.live, "rules.json"), "utf8")).toBe(OLD_RULES);
  });
  test.each(["posix", "win32"] as const)("Given %s IO flavor When sync mode is selected Then platform flushing is explicit", (flavor) => {
    expect(syncOpenModeFor(flavor === "win32" ? "win32" : "linux")).toBe(flavor === "win32" ? "r+" : "r");
  });
  test.each([["Collision.txt", "collision.txt"], ["caf\u00e9.txt", "cafe\u0301.txt"]])("Given equivalent names %s and %s When the filesystem represents them Then no spelling is silently lost", async (first, second) => {
    const f = await setup();
    await writeFile(path.join(f.live, first), "first");
    await writeFile(path.join(f.live, second), "second");
    const matching = (await readdir(f.live)).filter((name) => name.normalize("NFC").toLowerCase() === first.normalize("NFC").toLowerCase());
    if (matching.length === 2) {
      await expect(inspectContentTree(f.live)).rejects.toMatchObject({ code: "system_content_conflict" });
      expect(await readFile(path.join(f.live, first), "utf8")).toBe("first");
      expect(await readFile(path.join(f.live, second), "utf8")).toBe("second");
    } else {
      // Case/normalization-insensitive filesystems represent a single physical entry, not two colliding files.
      expect(matching).toHaveLength(1);
      const before = await inspectContentTree(f.live);
      await save(f);
      const after = await inspectContentTree(f.live);
      const entry = matching[0];
      if (entry === undefined) throw new Error("Missing represented entry");
      expect(after.inventory.find((file) => file[1] === entry)).toEqual(before.inventory.find((file) => file[1] === entry));
    }
  });
  test.each(["hardlink", "junction"] as const)("Given an excluded %s When observed Then copying refuses it without dereferencing", async (kind) => {
    const f = await setup();
    const outside = path.join(path.dirname(f.dbPath), "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "preserve");
    if (kind === "hardlink") await link(path.join(outside, "sentinel"), path.join(f.live, ".git/linked"));
    else await symlink(outside, path.join(f.live, ".git/linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(expectedDigest(environment(f.db, f.systemsRoot))).rejects.toMatchObject({ code: "system_content_conflict" });
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("preserve");
  });
  test("Given a mismatched owner at the derived control path When publication starts Then unknown bytes stay", async () => {
    const f = await setup();
    const paths = await contentPaths(f.systemsRoot, "test-system", OPERATION_ID);
    await mkdir(paths.control, { recursive: true });
    await writeFile(paths.owner, '{"version":1,"operation_id":"different","system_id":"test-system"}');
    await writeFile(path.join(paths.control, "sentinel"), "unknown");
    await expect(save(f)).rejects.toMatchObject({ code: "system_content_conflict" });
    expect(await readFile(path.join(paths.control, "sentinel"), "utf8")).toBe("unknown");
    expect((await recoverSystemContent(environment(f.db, f.systemsRoot))).held).toEqual([OPERATION_ID]);
  });
  test("Given strict provenance When unknown keys or extraction claims are persisted Then parsing fails closed", () => {
    const valid = { format: "system-content-v1", writer: "rules", source_extraction: null } as const;
    expect(parseContentProvenance(valid)).toEqual(valid);
    expect(() => parseContentProvenance({ ...valid, prompt: "untrusted" })).toThrow();
    expect(() => parseContentProvenance({ ...valid, writer: "future" })).toThrow();
    expect(() => parseContentProvenance({ ...valid, source_extraction: { receipt_id: "r", digest: "bad" } })).toThrow();
  });
  test("Given saved history bytes When nested lengths hashes or shapes change Then journal parsing fails", async () => {
    const f = await setup();
    const result = await save(f);
    const journal = parseContentJournal(JSON.parse(result.receipt?.metadataJson ?? "null"));
    const file = { bytes: "{}", length: 2, sha256: contentHash("{}") };
    const pair = { present: true, json: file, css: file };
    const withHistory: ContentJournal = { ...journal, palette_history: { emitter_version: "1", before: { present: false }, after: pair } };
    expect(parseContentJournal(withHistory).palette_history?.after).toEqual(pair);
    expect(() => parseContentJournal({ ...withHistory, extra: 1 })).toThrow();
    expect(() => parseContentJournal({ ...withHistory, palette_history: { ...withHistory.palette_history, after: { ...pair, css: { ...file, length: 3 } } } })).toThrow();
    expect(() => parseContentJournal({ ...withHistory, write_set: ["rules.json", "Rules.json"] })).toThrow();
    expect(() => parseContentJournal({ ...withHistory, result_preservation_digest: "bad" })).toThrow();
  });
});
