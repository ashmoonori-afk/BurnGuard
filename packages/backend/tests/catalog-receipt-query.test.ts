import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultPalette } from "@bg/shared/palette";
import { getCatalogReceiptById } from "../src/db/catalog-receipt-query";
import { getCurrentSystemContent, type CatalogReceiptRow } from "../src/db/catalog-repository";
import { validatePaletteTransferReceipt } from "../src/db/palette-transfer-repository";
import { copyCatalogSystem } from "../src/services/catalog-lifecycle";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { fixture } from "./fixtures/system-content-fixture";

const roots: string[] = [];
const databases: Database[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close(true);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "bg-receipt-query-"));
  roots.push(root);
  const value = await fixture(root, "replace");
  databases.push(value.db);
  return value;
}

function readFresh<T>(source: Awaited<ReturnType<typeof setup>>, read: (db: Database) => T): T {
  source.db.close(true);
  const reader = new Database(source.dbPath);
  databases.push(reader);
  const limit: unknown = Reflect.get(Database, "MAX_QUERY_CACHE_SIZE");
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Unsupported SQLite query cache limit");
  }
  for (let index = 0; index < limit; index += 1) reader.query(`SELECT ${index}`).get();
  // Hold real wrappers from either API until strict close has tested their ownership.
  const statements = [spyOn(reader, "prepare"), spyOn(reader, "query")];
  try {
    const value = read(reader);
    expect(() => reader.close(true)).not.toThrow();
    return value;
  } finally {
    for (const spy of statements) {
      for (const result of spy.mock.results) if (result.type === "return") result.value.finalize();
      spy.mockRestore();
    }
  }
}

test.each(["prepared", "committed", "recovering", "failed"] as const)(
  "Given a %s receipt When read by its bound ID Then every raw field survives and strict close succeeds",
  async status => {
    const f = await setup();
    const expected: CatalogReceiptRow = {
      id: "receipt' OR 1=1 --", designSystemId: "test-system", status,
      contentRevision: 7, schemaVersion: 2, digest: "a".repeat(64),
      manifestJson: '{"raw":"manifest"}', provenanceJson: '{"raw":"provenance"}', operation: "content",
      parentSystemId: "test-system", parentReceiptId: "decoy", parentDigest: "b".repeat(64),
      reason: "retained", metadataJson: '{"raw":"metadata"}', sourcePath: "source", destinationPath: "destination",
    };
    const rows: readonly CatalogReceiptRow[] = [
      { ...expected, id: "decoy", status: "committed", contentRevision: 6, digest: "b".repeat(64),
        parentReceiptId: null, parentDigest: null },
      expected,
    ];
    const insert = f.db.prepare(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,operation,
       parent_system_id,parent_receipt_id,parent_digest,reason,metadata_json,source_path,destination_path,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1)`);
    try {
      for (const row of rows) insert.run(row.id, row.designSystemId, row.status, row.contentRevision, row.schemaVersion,
        row.digest, row.manifestJson, row.provenanceJson, row.operation, row.parentSystemId, row.parentReceiptId,
        row.parentDigest, row.reason, row.metadataJson, row.sourcePath, row.destinationPath);
    } finally { insert.finalize(); }
    expect(readFresh(f, db => getCatalogReceiptById(db, expected.id))).toEqual(expected);
  },
);

test("Given a saturated cache and absent receipt When queried Then null is returned without an unowned statement", async () => {
  const f = await setup();
  expect(readFresh(f, db => getCatalogReceiptById(db, "missing"))).toBeNull();
});

test("Given persisted palette authority and a saturated cache When validated Then strict close precedes wrapper cleanup", async () => {
  const f = await setup();
  const env = paletteContentEnvironment(f.db, f.systemsRoot);
  const prior = await readDesignSystemPalette("test-system", env);
  await saveDesignSystemPalette("test-system", { expected_digest: prior.expected_digest, state: createDefaultPalette() }, env);
  // The fixture writer's lifecycle statements are separate from the fresh reader under test.
  const writes = spyOn(f.db, "prepare");
  try {
    await copyCatalogSystem(f.db, f.systemsRoot, "test-system",
      { id: "child", name: "Child", operation: "duplicate", reason: null, metadata: {} });
  } finally {
    for (const result of writes.mock.results) if (result.type === "return") result.value.finalize();
    writes.mockRestore();
  }
  const receipt = getCurrentSystemContent(f.db, "child");
  if (receipt === null) throw new Error("Missing palette receipt");
  expect(readFresh(f, db => validatePaletteTransferReceipt(db, receipt))).not.toBeNull();
});

test.each(["catalog-repository", "canonical-transfer-repository", "palette-transfer-repository"])(
  "Given a fresh process When %s is the first repository imported Then initialization succeeds without an initialized profile",
  async entry => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-cold-receipt-"));
    roots.push(root);
    const target = new URL(`../src/db/${entry}.ts`, import.meta.url).href;
    const child = Bun.spawn([process.execPath, "--eval", `await import(${JSON.stringify(target)});`], {
      env: { ...process.env, BG_APP_ROOT: root }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      timeout: 10_000, killSignal: "SIGKILL",
    });
    const [exit] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect(exit).toBe(0);
  },
);
