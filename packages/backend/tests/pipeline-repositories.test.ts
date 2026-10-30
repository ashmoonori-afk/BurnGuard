import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedEvent, TurnErrorCode, TurnRejectionReason, UserEvent } from "@bg/shared/events";
import { requiredArray, requiredBoolean, stringArray } from "@bg/shared/contract-parser";
import { parseLearningContract } from "@bg/shared/learning-contract";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { PaletteTransferProof } from "@bg/shared/palette";
import { createArtifactOperation, transitionArtifactOperation } from "../src/db/artifact-operation-repository";
import { CatalogRepositoryError, commitCatalogOperation, getContentReceipt, getCurrentSystemContent, getPendingSystemOperation, prepareCatalogOperation } from "../src/db/catalog-repository";
import { commitDesignSystemReceipt, getDesignSystemPipeline, prepareDesignSystemReceipt, updateDesignSystemMetadata } from "../src/db/design-system-repository";
import { insertSequencedEvent, listSequencedSessionEvents, parsePersistedNormalizedEvent, parsePersistedUserEvent } from "../src/db/event-sequence-repository";
import { persistNormalizedEvent } from "../src/db/events";
import { createExportAttempt, createExportRetry, getExportAttempt } from "../src/db/export-attempt-repository";
import { createLearningCheckpoint, getLearningCheckpoint, updateLearningProgress } from "../src/db/learning-repository";
import { runMigrationsFrom } from "../src/db/migrate";
import { PipelineRepositoryError, reconcilePipelineRows } from "../src/db/pipeline-repository";
import { PaletteTransferRepositoryError, readPaletteTransfer } from "../src/db/palette-transfer-repository";
import { digestEntries } from "../src/services/canonical-tree-manifest";
import { LogoDeliverableError } from "../src/services/logo-deliverables";
import { sanitizeTurnEvent } from "../src/services/turn-error-sanitizer";

let sqlite: Database;
let db: ReturnType<typeof drizzle>;
const migrations = path.join(import.meta.dir, "../src/db/migrations");

beforeEach(async () => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite);
  sqlite.exec("PRAGMA foreign_keys = ON");
  await runMigrationsFrom(sqlite, migrations);
  sqlite.exec(`
    INSERT INTO design_systems (id,name,status,dir_path,created_at,updated_at) VALUES ('ds','Original','draft','/missing/ds',1,1);
    INSERT INTO projects (id,name,type,dir_path,backend_id,current_revision,current_digest,created_at,updated_at) VALUES ('p','Project','prototype','/missing/p','codex',3,'project-digest',1,1);
    INSERT INTO sessions (id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1);
    INSERT INTO exports (id,project_id,format,status,options_json,created_at) VALUES ('job','p','pdf','pending','{"pdf_paper":"a4"}',1);
    INSERT INTO learning_items (id,kind,title,content_json,created_at,updated_at) VALUES ('lesson','lesson','Lesson','{}',1,1);
    INSERT INTO learning_progress (item_id,state,revision,feedback_draft,updated_at) VALUES ('lesson','not_started',0,NULL,1);
  `);
});
afterEach(() => sqlite.close());

function repositoryError(error: unknown): PipelineRepositoryError {
  expect(error).toBeInstanceOf(PipelineRepositoryError);
  if (!(error instanceof PipelineRepositoryError)) throw error;
  return error;
}

function importedPaletteReceipt() {
  const proof: PaletteTransferProof = {
    schema_version: 1, emitter_version: "burnguard-palette-2",
    state: { size_bytes: 2, sha256: createHash("sha256").update("{}").digest("hex") },
    css: { size_bytes: 1, sha256: createHash("sha256").update("\n").digest("hex") },
  };
  const files = [
    { path: "palette/scales.css", size: proof.css.size_bytes, sha256: proof.css.sha256 },
    { path: "palette/state.json", size: proof.state.size_bytes, sha256: proof.state.sha256 },
  ];
  return {
    id: "imported", designSystemId: "ds", contentRevision: 1, schemaVersion: 1,
    digest: "extraction-digest", provenance: { state: "observed" }, createdAt: 2,
    manifest: { schema_version: 1, digest_algorithm: "sha256", tree_digest: digestEntries(files), files, publication_state: "validated" },
    paletteTransfer: proof,
  };
}

describe("design system repository", () => {
  test("Given a trusted imported proof When receipt preparation and commit succeed Then the same v1 owner retains its extraction identity and proof", () => {
    // Given
    const input = importedPaletteReceipt();

    // When
    prepareDesignSystemReceipt(db, input);
    const committed = commitDesignSystemReceipt(db, { id: input.id, digest: input.digest, updatedAt: 3 });

    // Then
    expect(committed).toMatchObject({ id: input.id, contentRevision: 1, schemaVersion: 1, digest: input.digest, provenance: input.provenance });
    expect(committed.digest).not.toBe(input.manifest.tree_digest);
    expect(readPaletteTransfer(sqlite, input.id)).toEqual(input.paletteTransfer);
    expect(sqlite.query("SELECT id,status FROM design_system_receipts WHERE design_system_id='ds'").all())
      .toEqual([{ id: input.id, status: "committed" }]);
  });

  test("Given a proof insertion fault When an imported receipt prepares Then the receipt and proof roll back together", () => {
    // Given
    sqlite.exec(`CREATE TRIGGER reject_palette_transfer BEFORE INSERT ON design_system_palette_transfers
      BEGIN SELECT RAISE(ABORT, 'injected transfer insertion failure'); END`);
    const before = sqlite.serialize();

    // When / Then
    expect(() => prepareDesignSystemReceipt(db, importedPaletteReceipt()))
      .toThrow(new PaletteTransferRepositoryError("palette_transfer_conflict", "imported"));
    expect(sqlite.serialize()).toEqual(before);
    expect(sqlite.query("SELECT id FROM design_system_receipts WHERE id='imported'").get()).toBeNull();
    expect(readPaletteTransfer(sqlite, "imported")).toBeNull();
  });

  test.each(["prepared", "recovering", "committed"] as const)("Given the same %s imported proof When prepare retries with reordered keys Then all stored bytes remain unchanged", status => {
    // Given
    const input = importedPaletteReceipt();
    const receipt = prepareDesignSystemReceipt(db, input);
    sqlite.prepare("UPDATE design_system_receipts SET status=? WHERE id=?").run(status, input.id);
    const before = sqlite.serialize();
    const proof = input.paletteTransfer;

    // When
    const retried = prepareDesignSystemReceipt(db, { ...input, paletteTransfer: {
      css: { sha256: proof.css.sha256, size_bytes: proof.css.size_bytes },
      state: { sha256: proof.state.sha256, size_bytes: proof.state.size_bytes },
      emitter_version: proof.emitter_version, schema_version: proof.schema_version,
    } });

    // Then
    expect(retried).toEqual(receipt);
    expect(sqlite.serialize()).toEqual(before);
  });

  test.each(["emitter", "state-size", "state-hash", "css-size", "css-hash", "missing"] as const)(
    "Given an attached proof When retry changes %s Then it conflicts without repairing storage", field => {
      // Given
      const input = importedPaletteReceipt();
      prepareDesignSystemReceipt(db, input);
      const proof = input.paletteTransfer;
      const alternatives: Readonly<Record<typeof field, PaletteTransferProof | undefined>> = {
        emitter: { ...proof, emitter_version: "burnguard-palette-1" },
        "state-size": { ...proof, state: { ...proof.state, size_bytes: proof.state.size_bytes + 1 } },
        "state-hash": { ...proof, state: { ...proof.state, sha256: "a".repeat(64) } },
        "css-size": { ...proof, css: { ...proof.css, size_bytes: proof.css.size_bytes + 1 } },
        "css-hash": { ...proof, css: { ...proof.css, sha256: "b".repeat(64) } },
        missing: undefined,
      };
      const { paletteTransfer: _proof, ...withoutProof } = input;
      const alternative = alternatives[field];
      const retry = alternative === undefined ? withoutProof : { ...withoutProof, paletteTransfer: alternative };
      const before = sqlite.serialize();

      // When / Then
      expect(() => prepareDesignSystemReceipt(db, retry)).toThrow(new PipelineRepositoryError("content_receipt_mismatch", "ds"));
      expect(sqlite.serialize()).toEqual(before);
    },
  );

  test.each(["prepared", "recovering", "committed"] as const)("Given an unproved %s receipt When retry supplies a proof Then it cannot attach authority retroactively", status => {
    // Given
    const input = importedPaletteReceipt();
    const { paletteTransfer: _proof, ...withoutProof } = input;
    prepareDesignSystemReceipt(db, withoutProof);
    sqlite.prepare("UPDATE design_system_receipts SET status=? WHERE id=?").run(status, input.id);
    const before = sqlite.serialize();

    // When / Then
    expect(() => prepareDesignSystemReceipt(db, input)).toThrow(new PipelineRepositoryError("content_receipt_mismatch", "ds"));
    expect(sqlite.serialize()).toEqual(before);
    expect(readPaletteTransfer(sqlite, input.id)).toBeNull();
  });

  test.each(["prepared", "recovering"] as const)("Given a %s receipt with divergent attached proof When commit runs Then validation leaves its status and bytes untouched", status => {
    // Given
    const input = importedPaletteReceipt();
    prepareDesignSystemReceipt(db, input);
    sqlite.prepare("UPDATE design_system_receipts SET status=? WHERE id=?").run(status, input.id);
    sqlite.prepare("UPDATE design_system_palette_transfers SET state_sha256=? WHERE receipt_id=?").run("a".repeat(64), input.id);
    const before = sqlite.serialize();

    // When / Then
    expect(() => commitDesignSystemReceipt(db, { id: input.id, digest: input.digest, updatedAt: 3 }))
      .toThrow(new PaletteTransferRepositoryError("palette_transfer_corrupt", input.id));
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given Unicode-equivalent tags and a content receipt When metadata updates Then tags are NFC stable and content identity is unchanged", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: { files: [] }, provenance: { state: "unknown" }, createdAt: 2 });
    commitDesignSystemReceipt(db, { id: "r1", digest: "digest", updatedAt: 2 });
    const before = getDesignSystemPipeline(db, "ds");

    // When
    const result = updateDesignSystemMetadata(db, { id: "ds", expectedRevision: 0, name: "Renamed", description: null, tags: ["z", "e\u0301", "é", " a "], updatedAt: 3 });

    // Then
    expect(result).toEqual({ id: "ds", metadataRevision: 1, tags: ["a", "z", "é"] });
    expect(getDesignSystemPipeline(db, "ds").receipt).toEqual(before.receipt);
    expect(sqlite.query("SELECT name,metadata_revision FROM design_systems WHERE id='ds'").get()).toEqual({ name: "Renamed", metadata_revision: 1 });
  });

  test("Given stale metadata and conflicting receipt writes When attempted Then typed conflicts leave all rows unchanged", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: { state: "unknown" }, createdAt: 2 });
    const before = sqlite.serialize();

    // When / Then
    try { updateDesignSystemMetadata(db, { id: "ds", expectedRevision: 9, name: "Bad", description: null, tags: ["bad"], updatedAt: 3 }); } catch (error) { expect(repositoryError(error).code).toBe("expected_revision_conflict"); }
    try { prepareDesignSystemReceipt(db, { id: "r2", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "other", manifest: {}, provenance: { state: "unknown" }, createdAt: 3 }); } catch (error) { expect(repositoryError(error).code).toBe("content_receipt_mismatch"); }
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given malformed normalized tags When catalog state is read Then a typed corruption code is returned", () => {
    // Given
    sqlite.exec("INSERT INTO design_system_tags (design_system_id,tag,ordinal) VALUES ('ds','é',0)");

    // When / Then
    try { getDesignSystemPipeline(db, "ds"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_tag"); }
  });

  test("Given a corrupted receipt payload When catalog state is read Then a typed JSON code is returned", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: { state: "unknown" }, createdAt: 2 });
    commitDesignSystemReceipt(db, { id: "r1", digest: "digest", updatedAt: 2 });
    sqlite.exec("UPDATE design_system_receipts SET manifest_json='{' WHERE id='r1'");

    // When / Then
    try { getDesignSystemPipeline(db, "ds"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
  });

  test.each(["prepared", "recovering", "failed"] as const)("Given a committed head and a newer %s attempt When current content is read Then the committed identity wins", (status) => {
    // Given
    prepareDesignSystemReceipt(db, { id: "head", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "extraction-digest", manifest: { files: [] }, provenance: { state: "observed" }, createdAt: 2 });
    commitDesignSystemReceipt(db, { id: "head", digest: "extraction-digest", updatedAt: 2 });
    const head = getCurrentSystemContent(sqlite, "ds");
    prepareDesignSystemReceipt(db, { id: "attempt", designSystemId: "ds", contentRevision: 2, schemaVersion: 1, digest: "candidate-digest", manifest: {}, provenance: {}, createdAt: 3 });
    sqlite.prepare("UPDATE design_system_receipts SET status=? WHERE id='attempt'").run(status);
    const before = sqlite.serialize();

    // When
    const current = getCurrentSystemContent(sqlite, "ds");
    const pipeline = getDesignSystemPipeline(db, "ds");

    // Then
    expect(current).toEqual(head);
    expect(getContentReceipt(sqlite, "ds")).toEqual(head);
    expect(pipeline.receipt).toMatchObject({ id: "head", contentRevision: 1, digest: "extraction-digest" });
    expect(getPendingSystemOperation(sqlite, "ds")?.id ?? null).toBe(status === "failed" ? null : "attempt");
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given no receipts When current content is read Then the legacy baseline is explicitly null", () => {
    // Given / When
    const current = getCurrentSystemContent(sqlite, "ds");

    // Then
    expect(current).toBeNull();
    expect(getPendingSystemOperation(sqlite, "ds")).toBeNull();
    expect(getDesignSystemPipeline(db, "ds").receipt).toBeNull();
  });

  test.each(["duplicate", "derive"] as const)("Given committed %s lineage and newer uncommitted rows When current content is read Then latest committed lineage is the fallback", (operation) => {
    // Given
    sqlite.prepare(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation,parent_system_id,parent_receipt_id,parent_digest)
      VALUES ('older','ds','committed',-1,1,'old','{}','{}',2,2,'duplicate','parent','parent-old','old'),
        ('lineage','ds','committed',-2,1,'inherited','{}','{}',3,3,?,'parent','parent-head','inherited'),
        ('failed','ds','failed',1,1,'failed','{}','{}',4,4,'content',NULL,NULL,NULL),
        ('pending','ds','prepared',-3,1,'pending','{}','{}',5,5,'derive','parent','parent-next','pending')`).run(operation);

    // When
    const current = getCurrentSystemContent(sqlite, "ds");

    // Then
    expect(current).toMatchObject({ id: "lineage", operation, parentReceiptId: "parent-head", parentDigest: "inherited" });
    expect(getContentReceipt(sqlite, "ds")).toBeNull();
    expect(getDesignSystemPipeline(db, "ds").receipt).toMatchObject({ id: "lineage", digest: "inherited" });
  });

  test("Given out-of-order committed revisions and newer lineage When current content is read Then highest positive content revision wins", () => {
    // Given
    sqlite.exec(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation)
      VALUES ('head','ds','committed',3,1,'third','{}','{}',2,2,'content'),
        ('older','ds','committed',1,1,'first','{}','{}',3,3,'content'),
        ('zero','ds','committed',0,1,'zero','{}','{}',4,4,'content'),
        ('lineage','ds','committed',-1,1,'inherited','{}','{}',5,5,'derive')`);

    // When / Then
    expect(getCurrentSystemContent(sqlite, "ds")).toMatchObject({ id: "head", contentRevision: 3 });
  });

  test.each(["prepared", "recovering", "committed"] as const)("Given the same %s receipt When prepare is retried Then its identity and stored bytes are unchanged", (status) => {
    // Given
    const input = { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: {}, createdAt: 2 };
    const receipt = prepareDesignSystemReceipt(db, input);
    sqlite.prepare("UPDATE design_system_receipts SET status=? WHERE id='r1'").run(status);
    const before = sqlite.serialize();

    // When / Then
    expect(prepareDesignSystemReceipt(db, input)).toEqual(receipt);
    expect(sqlite.serialize()).toEqual(before);
  });

  test.each(["content", "trash"] as const)("Given a pending %s owner When another content receipt prepares Then a typed conflict preserves both authority and rows", (operation) => {
    // Given
    sqlite.prepare(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation)
      VALUES ('owner','ds','recovering',?,1,'owner','{}','{}',2,2,?)`).run(operation === "content" ? 1 : -1, operation);
    const before = sqlite.serialize();

    // When / Then
    expect(() => prepareDesignSystemReceipt(db, { id: "r2", designSystemId: "ds", contentRevision: 2, schemaVersion: 1, digest: "other", manifest: {}, provenance: {}, createdAt: 3 })).toThrow(new PipelineRepositoryError("content_receipt_mismatch", "ds"));
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given an older committed receipt and a different pending owner When the old prepare repeats Then idempotency cannot bypass ownership", () => {
    // Given
    const input = { id: "head", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: {}, createdAt: 2 };
    prepareDesignSystemReceipt(db, input);
    commitDesignSystemReceipt(db, { id: "head", digest: "digest", updatedAt: 2 });
    prepareDesignSystemReceipt(db, { ...input, id: "pending", contentRevision: 2, createdAt: 3 });

    // When / Then
    expect(() => prepareDesignSystemReceipt(db, input)).toThrow(new PipelineRepositoryError("content_receipt_mismatch", "ds"));
    expect(getPendingSystemOperation(sqlite, "ds")?.id).toBe("pending");
  });

  test.each(["prepared", "recovering"] as const)("Given %s content ownership When lifecycle preparation runs Then it cannot acquire the system", (status) => {
    // Given
    prepareDesignSystemReceipt(db, { id: "owner", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: {}, createdAt: 2 });
    sqlite.prepare("UPDATE design_system_receipts SET status=? WHERE id='owner'").run(status);
    const before = sqlite.serialize();

    // When / Then
    expect(() => prepareCatalogOperation(sqlite, { systemId: "ds", operation: "trash", digest: "digest", manifestJson: "{}", provenanceJson: "{}", parentSystemId: "ds", parentReceiptId: "owner", parentDigest: "digest", reason: null, metadata: {}, sourcePath: "/missing/ds", destinationPath: "/missing/trash/ds", now: 3 })).toThrow(new CatalogRepositoryError("operation_conflict", "ds"));
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given prepared content When startup marks recovery and commit succeeds Then pending ownership releases without rewriting its digest", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "extraction-digest", manifest: { tree_digest: "different-tree-digest" }, provenance: { state: "observed" }, createdAt: 2 });

    // When
    reconcilePipelineRows(db, 3);
    const recovering = getPendingSystemOperation(sqlite, "ds");
    commitDesignSystemReceipt(db, { id: "r1", digest: "extraction-digest", updatedAt: 4 });

    // Then
    expect(recovering).toMatchObject({ id: "r1", status: "recovering" });
    expect(getPendingSystemOperation(sqlite, "ds")).toBeNull();
    expect(getCurrentSystemContent(sqlite, "ds")).toMatchObject({ id: "r1", schemaVersion: 1, digest: "extraction-digest", manifestJson: '{"tree_digest":"different-tree-digest"}' });
    expect(() => commitDesignSystemReceipt(db, { id: "r1", digest: "extraction-digest", updatedAt: 5 })).toThrow(new PipelineRepositoryError("content_receipt_mismatch", "r1"));
  });

  test("Given content ownership When the lifecycle committer receives its ID Then the pending content and lifecycle remain untouched", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "owner", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: {}, createdAt: 2 });
    const before = sqlite.serialize();

    // When / Then
    expect(() => commitCatalogOperation(sqlite, "owner", "trashed", 3)).toThrow(new CatalogRepositoryError("operation_conflict", "owner"));
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given a pending lifecycle receipt When the content committer receives its ID Then it cannot commit another owner's operation", () => {
    // Given
    const receiptId = prepareCatalogOperation(sqlite, { systemId: "ds", operation: "trash", digest: "digest", manifestJson: "{}", provenanceJson: "{}", parentSystemId: "ds", parentReceiptId: "head", parentDigest: "digest", reason: null, metadata: {}, sourcePath: "/missing/ds", destinationPath: "/missing/trash/ds", now: 2 });
    const before = sqlite.serialize();

    // When / Then
    expect(() => commitDesignSystemReceipt(db, { id: receiptId, digest: "digest", updatedAt: 3 })).toThrow(new PipelineRepositoryError("content_receipt_mismatch", receiptId));
    expect(sqlite.serialize()).toEqual(before);
  });

  test.each(["prepared", "recovering"] as const)("Given a %s lifecycle owner When its lifecycle commits Then content authority survives and pending ownership releases", (status) => {
    // Given
    prepareDesignSystemReceipt(db, { id: "head", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: {}, createdAt: 2 });
    commitDesignSystemReceipt(db, { id: "head", digest: "digest", updatedAt: 2 });
    const receiptId = prepareCatalogOperation(sqlite, { systemId: "ds", operation: "trash", digest: "digest", manifestJson: "{}", provenanceJson: "{}", parentSystemId: "ds", parentReceiptId: "head", parentDigest: "digest", reason: null, metadata: {}, sourcePath: "/missing/ds", destinationPath: "/missing/trash/ds", now: 3 });
    sqlite.prepare("UPDATE design_system_receipts SET status=? WHERE id=?").run(status, receiptId);

    // When
    commitCatalogOperation(sqlite, receiptId, "trashed", 4);

    // Then
    expect(getCurrentSystemContent(sqlite, "ds")?.id).toBe("head");
    expect(getPendingSystemOperation(sqlite, "ds")).toBeNull();
    expect(sqlite.query("SELECT lifecycle FROM design_systems WHERE id='ds'").get()).toEqual({ lifecycle: "trashed" });
  });

  test("Given a pending content receipt When commit supplies the wrong digest Then ownership and the legacy baseline remain unchanged", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "owner", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: {}, createdAt: 2 });
    const before = sqlite.serialize();

    // When / Then
    expect(() => commitDesignSystemReceipt(db, { id: "owner", digest: "wrong", updatedAt: 3 })).toThrow(new PipelineRepositoryError("content_receipt_mismatch", "owner"));
    expect(getCurrentSystemContent(sqlite, "ds")).toBeNull();
    expect(sqlite.serialize()).toEqual(before);
  });
});

describe("system pending receipt migration", () => {
  test.each([
    ["content", "content", "prepared"], ["content", "content", "recovering"],
    ["content", "trash", "prepared"], ["content", "trash", "recovering"],
    ["trash", "content", "prepared"], ["trash", "content", "recovering"],
  ] as const)("Given %s ownership When SQL inserts %s in %s state Then the migrated unique index rejects it", (ownerOperation, operation, status) => {
    // Given
    sqlite.prepare(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation)
      VALUES ('owner','ds','prepared',?,1,'digest','{}','{}',2,2,?)`).run(ownerOperation === "content" ? 1 : -1, ownerOperation);
    const before = sqlite.serialize();

    // When / Then
    expect(() => sqlite.prepare(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation)
      VALUES ('contender','ds',?,?,1,'other','{}','{}',3,3,?)`).run(status, operation === "content" ? 2 : -2, operation)).toThrow("UNIQUE constraint failed: design_system_receipts.design_system_id");
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given a failed receipt and a new pending owner When SQL revives the failed receipt Then uniqueness also guards recovery transitions", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "failed", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "first", manifest: {}, provenance: {}, createdAt: 2 });
    sqlite.exec("UPDATE design_system_receipts SET status='failed' WHERE id='failed'");
    prepareDesignSystemReceipt(db, { id: "owner", designSystemId: "ds", contentRevision: 2, schemaVersion: 1, digest: "second", manifest: {}, provenance: {}, createdAt: 3 });
    const before = sqlite.serialize();

    // When / Then
    expect(() => sqlite.exec("UPDATE design_system_receipts SET status='recovering' WHERE id='failed'")).toThrow("UNIQUE constraint failed: design_system_receipts.design_system_id");
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given valid legacy pending operations When publication migrations run Then one strict index guards both operation classes and the obsolete index is removed", async () => {
    // Given
    const directory = await mkdtemp(path.join(tmpdir(), "burnguard-pending-receipt-upgrade-"));
    const historical = new Database(":memory:");
    try {
      historical.exec("PRAGMA foreign_keys = ON");
      for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql") && name < "0023")) {
        await cp(path.join(migrations, file), path.join(directory, file));
      }
      await runMigrationsFrom(historical, directory);
      historical.exec(`
        INSERT INTO design_systems (id,name,status,dir_path,created_at,updated_at) VALUES
          ('content-owner','Content','draft','/missing/content-owner',1,1),
          ('lifecycle-owner','Lifecycle','draft','/missing/lifecycle-owner',1,1);
        INSERT INTO design_system_receipts
          (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation) VALUES
          ('content','content-owner','prepared',1,1,'content-digest','{}','{}',2,2,'content'),
          ('lifecycle','lifecycle-owner','recovering',-1,1,'lifecycle-digest','{}','{}',2,2,'trash')`);
      const rows = historical.query("SELECT * FROM design_system_receipts ORDER BY id").all();

      // When
      await runMigrationsFrom(historical, migrations);

      // Then
      expect(historical.query(`SELECT name,"unique" AS is_unique,partial
        FROM pragma_index_list('design_system_receipts') WHERE origin='c' AND "unique"=1 ORDER BY name`).all()).toEqual([
        { name: "uq_design_system_pending_receipt", is_unique: 1, partial: 1 },
      ]);
      expect(historical.query("SELECT name FROM pragma_index_info('uq_design_system_pending_receipt') ORDER BY seqno").all()).toEqual([
        { name: "design_system_id" },
      ]);
      for (const [systemId, revision, operation] of [
        ["content-owner", -1, "trash"],
        ["lifecycle-owner", 1, "content"],
      ] as const) {
        expect(() => historical.prepare(`INSERT INTO design_system_receipts
          (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation)
          VALUES ('contender',?,'prepared',?,1,'candidate','{}','{}',3,3,?)`).run(systemId, revision, operation)).toThrow("UNIQUE constraint failed: design_system_receipts.design_system_id");
      }
      expect(historical.query("SELECT * FROM design_system_receipts ORDER BY id").all()).toEqual(rows);
      expect(historical.query("SELECT id FROM schema_migrations WHERE id IN ('0023_system_content_publication.sql','0024_system_content_publication_cleanup.sql') ORDER BY id").all()).toEqual([
        { id: "0023_system_content_publication.sql" },
        { id: "0024_system_content_publication_cleanup.sql" },
      ]);
      expect(historical.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(historical.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      historical.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test.each(["content", "trash"] as const)("Given historical content and %s pending rows When the forward migration runs Then explicit failure preserves database bytes and rows", async (operation) => {
    // Given: apply only actual pre-0023 migrations to a fresh connection.
    const directory = await mkdtemp(path.join(tmpdir(), "burnguard-pending-receipt-migration-"));
    const historical = new Database(":memory:");
    try {
      historical.exec("PRAGMA foreign_keys = ON");
      for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql") && name < "0023")) {
        await cp(path.join(migrations, file), path.join(directory, file));
      }
      await runMigrationsFrom(historical, directory);
      historical.exec(`
        INSERT INTO design_systems (id,name,status,dir_path,created_at,updated_at)
          VALUES ('ds','Original','draft','/missing/ds',1,1);
        INSERT INTO design_system_receipts
          (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at)
          VALUES ('owner','ds','prepared',1,1,'old-extraction-digest','{"files":[]}','{"state":"observed"}',2,2)`);
      historical.prepare(`INSERT INTO design_system_receipts
        (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation)
        VALUES ('conflict','ds','recovering',?,1,'preserve-me','{}','{}',3,3,?)`).run(operation === "content" ? 2 : -1, operation);
      const before = historical.serialize();
      const rows = historical.query("SELECT * FROM design_system_receipts ORDER BY id").all();

      // When / Then
      await expect(runMigrationsFrom(historical, migrations)).rejects.toThrow("UNIQUE constraint failed: design_system_receipts.design_system_id");
      expect(historical.serialize()).toEqual(before);
      expect(historical.query("SELECT * FROM design_system_receipts ORDER BY id").all()).toEqual(rows);
      expect(historical.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    } finally {
      historical.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("learning repository", () => {
  test("Given a complete learning contract When canonical parsing runs Then context and progress remain typed", () => {
    // Given
    const input = {
      id: "lesson", kind: "lesson", revision: 1,
      progress: { state: "in_progress", revision: 1, expected_revision: 1, feedback_draft: null },
      checkpoint: { id: "cp", parent_checkpoint_id: null, artifact_revision: 3, artifact_digest: "project-digest", next_context: { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3, artifact_digest: "project-digest" } },
    };

    // When
    const parsed = parseLearningContract(input);

    // Then
    expect(parsed.kind).toBe("lesson");
    expect(parsed.progress.state).toBe("in_progress");
    expect(parsed.checkpoint?.next_context.artifact_digest).toBe("project-digest");
    expect(requiredBoolean({ enabled: true }, "enabled")).toBe(true);
    expect(requiredArray({ items: [] }, "items")).toEqual([]);
    expect(stringArray({ tags: ["a"] }, "tags")).toEqual(["a"]);
  });

  test("Given valid JSON with incomplete next context When checkpoint is read Then every shape is rejected as corrupt", () => {
    // Given
    const invalidContexts = [
      {},
      { kind: "iteration" },
      { kind: "iteration", parent_checkpoint_id: "cp" },
      { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1 },
      { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3 },
    ];
    for (const [index, context] of invalidContexts.entries()) {
      sqlite.prepare("INSERT INTO learning_checkpoints (id,item_id,project_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES (?,?,?,?,?,?,?,?)").run(`bad-${index}`, "lesson", "p", 3, "project-digest", "done", JSON.stringify(context), index + 3);
    }

    // When / Then
    for (const index of invalidContexts.keys()) {
      try { getLearningCheckpoint(db, `bad-${index}`); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
    }
    expect.assertions(invalidContexts.length * 2);
  });

  test("Given progress revision zero When CAS and digest-bound checkpoint commit Then stale writers fail and checkpoint remains immutable", () => {
    // Given / When
    expect(updateLearningProgress(db, { itemId: "lesson", expectedRevision: 0, state: "in_progress", feedbackDraft: "draft", updatedAt: 2 }).revision).toBe(1);
    createLearningCheckpoint(db, { id: "cp", itemId: "lesson", projectId: "p", artifactRevision: 3, artifactDigest: "project-digest", parentCheckpointId: null, feedback: "done", nextContext: { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3, artifact_digest: "project-digest" }, createdAt: 3 });

    // Then
    try { updateLearningProgress(db, { itemId: "lesson", expectedRevision: 0, state: "completed", feedbackDraft: null, updatedAt: 4 }); } catch (error) { expect(repositoryError(error).code).toBe("expected_revision_conflict"); }
    try { createLearningCheckpoint(db, { id: "cp", itemId: "lesson", projectId: "p", artifactRevision: 3, artifactDigest: "wrong", parentCheckpointId: null, feedback: "bad", nextContext: { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3, artifact_digest: "wrong" }, createdAt: 4 }); } catch (error) { expect(repositoryError(error).code).toBe("artifact_identity_mismatch"); }
    expect(() => sqlite.exec("UPDATE learning_checkpoints SET artifact_digest='changed' WHERE id='cp'")).toThrow();
    expect(getLearningCheckpoint(db, "cp").artifactDigest).toBe("project-digest");
  });
});

describe("artifact, export, event, and recovery repositories", () => {
  test("Given a working artifact operation When another starts and startup reconciles Then one authority and deterministic recovery hold", () => {
    // Given
    createArtifactOperation(db, { id: "op1", projectId: "p", baseRevision: 3, baseDigest: "project-digest", expectedRevision: 3, expectedFileHash: "file", nodeFingerprint: "node", diff: { exact: true }, snapshot: { id: "snap" }, retention: { retained: true }, replay: { cursor: 1 }, createdAt: 2 });
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: { state: "unknown" }, createdAt: 2 });

    // When / Then
    expect(() => createArtifactOperation(db, { id: "op2", projectId: "p", baseRevision: 3, baseDigest: "project-digest", expectedRevision: 3, expectedFileHash: "file", nodeFingerprint: "node", diff: {}, snapshot: {}, retention: {}, replay: {}, createdAt: 3 })).toThrow();
    expect(reconcilePipelineRows(db, 4)).toEqual({ receipts: 1, operations: 1, attempts: 0 });
    expect(reconcilePipelineRows(db, 5)).toEqual({ receipts: 0, operations: 0, attempts: 0 });
    expect(transitionArtifactOperation(db, { id: "op1", from: "recovering", to: "failed", resultRevision: null, resultDigest: null, updatedAt: 6 }).status).toBe("failed");
  });

  test("Given a committed operation When it transitions Then project stable revision and digest advance atomically", () => {
    // Given
    createArtifactOperation(db, { id: "op", projectId: "p", baseRevision: 3, baseDigest: "project-digest", expectedRevision: 3, expectedFileHash: "file", nodeFingerprint: "node", diff: {}, snapshot: {}, retention: {}, replay: {}, createdAt: 2 });

    // When
    transitionArtifactOperation(db, { id: "op", from: "working", to: "committed", resultRevision: 4, resultDigest: "next-digest", updatedAt: 3 });

    // Then
    expect(sqlite.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 4, current_digest: "next-digest" });
  });

  test("Given canonical export options When attempt progresses and job options mutate Then retry preserves the parent snapshot", () => {
    // Given
    const canonical = "{\"pdf_paper\":\"a4\"}";
    createExportAttempt(db, { id: "a1", jobId: "job", parentAttemptId: null, projectRevision: 3, projectDigest: "project-digest", status: "failed", progress: { stage: "render", completed: 1, total: 2 }, stopReason: "render_failed", digests: { options: "ignored", input_closure: "i", renderer: "r", capture: "c", output: "out", receipt: "rec" }, findings: [], retention: { retained_until: 9, output_available: false }, createdAt: 2 });
    sqlite.exec("UPDATE exports SET options_json='{\"pdf_paper\":\"letter\"}' WHERE id='job'");

    // When
    const retry = createExportRetry(db, { id: "a2", parentAttemptId: "a1", createdAt: 3 });

    // Then
    expect(retry).toMatchObject({ id: "a2", parentAttemptId: "a1", canonicalOptions: { pdf_paper: "a4" } });
    expect(sqlite.query("SELECT canonical_options_json,options_digest FROM export_attempts WHERE id='a1'").get()).toEqual({ canonical_options_json: canonical, options_digest: createHash("sha256").update(canonical).digest("hex") });
    expect(reconcilePipelineRows(db, 4).attempts).toBe(1);
    expect(getExportAttempt(db, "a1")).toMatchObject({ stopReason: "render_failed", progress: { stage: "render", completed: 1, total: 2 }, digests: { receipt: "rec" } });
  });

  test("Given invalid real export options When attempt creation runs Then typed rejection leaves zero attempts", () => {
    // Given
    sqlite.exec("UPDATE exports SET options_json='{\"scale\":\"not-a-number\"}' WHERE id='job'");

    // When / Then
    try { createExportAttempt(db, { id: "a1", jobId: "job", parentAttemptId: null, projectRevision: 3, projectDigest: "project-digest", status: "failed", progress: {}, digests: { options: "wrong", input_closure: "i", renderer: "r", capture: "c", output: "out", receipt: "rec" }, findings: [], retention: {}, createdAt: 2 }); } catch (error) { expect(repositoryError(error).code).toBe("invalid_options"); }
    expect(sqlite.query("SELECT COUNT(*) AS count FROM export_attempts").get()).toEqual({ count: 0 });
  });

  test("Given every persisted event variant When decoded Then strict readers preserve its discriminant", () => {
    // Given
    const base = { id: "e", ts: 1, turnId: "t" };
    const normalized: NormalizedEvent[] = [
      { ...base, type: "chat.user_message", text: "x", attachmentCount: 0 }, { ...base, type: "chat.delta", text: "x" },
      { ...base, type: "chat.thinking", text: "x" }, { ...base, type: "chat.message_end" },
      { ...base, type: "tool.started", toolCallId: "c", tool: "x", input: {} }, { ...base, type: "tool.finished", toolCallId: "c", tool: "x", ok: true, output: {} },
      { ...base, type: "tool.permission_required", toolCallId: "c", tool: "x", input: {} }, { ...base, type: "file.changed", action: "edited", path: "x" },
      { id: "e", ts: 1, type: "status.running" }, { id: "e", ts: 1, type: "status.idle", stopReason: "end_turn" },
      { id: "e", ts: 1, type: "status.error", message: "x", recoverable: true }, { id: "e", ts: 1, type: "usage.delta", input: 1, output: 2, cached: 3 },
    ];
    const users: UserEvent[] = [{ type: "user.message", text: "x", attachments: ["a"] }, { type: "user.interrupt" }, { type: "user.tool_decision", toolCallId: "c", decision: "allow", reason: "ok" }];

    // When
    const normalizedTypes = normalized.map((item, index) => parsePersistedNormalizedEvent(JSON.stringify(item), `n${index}`).type);
    const userTypes = users.map((item, index) => parsePersistedUserEvent(JSON.stringify(item), `u${index}`).type);

    // Then
    expect(normalizedTypes).toEqual(normalized.map((item) => item.type));
    expect(userTypes).toEqual(users.map((item) => item.type));
    try { parsePersistedNormalizedEvent("{}", "bad"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
  });

  test("Given a persisted sanitized logo failure When replayed Then its stage code and terminal idle survive without diagnostics", () => {
    // Given
    const cause = new LogoDeliverableError("rounds_changed");
    const safe = sanitizeTurnEvent({ id: "logo-error", ts: 10, type: "status.error", message: "private-stage-diagnostic", recoverable: true }, cause);
    const error = persistNormalizedEvent(sqlite, "s", safe);
    const idle = persistNormalizedEvent(sqlite, "s", { id: "logo-idle", ts: 10, type: "status.idle", stopReason: "error" });

    // When
    const replay = listSequencedSessionEvents(sqlite, "s", 0);

    // Then
    expect(replay).toEqual([error, idle]);
    expect(replay[0]?.event).toMatchObject({ type: "status.error", code: "logo_deliverables_missing", recoverable: true });
    expect(JSON.stringify(replay)).not.toContain("private-stage-diagnostic");
    expect(JSON.stringify(replay)).not.toContain(cause.detail);
  });

  test("Given every shared turn error code When persisted and replayed Then strict readers preserve all codes", () => {
    // Given: Record makes additions to the shared DTO require replay coverage.
    const codes = {
      graphic_requires_authenticated_codex: "graphic_requires_authenticated_codex", graphic_starter_unchanged: "graphic_starter_unchanged",
      logo_requires_authenticated_codex: "logo_requires_authenticated_codex", logo_deliverables_missing: "logo_deliverables_missing",
      logo_image_provenance_missing: "logo_image_provenance_missing", design_review_failed: "design_review_failed",
      logo_directions_invalid: "logo_directions_invalid", logo_originality_rejected: "logo_originality_rejected",
      commandcode_unavailable: "commandcode_unavailable", unsupported_generation_model_effort: "unsupported_generation_model_effort",
      backend_unavailable: "backend_unavailable", agent_control_files_present: "agent_control_files_present", path_unavailable: "path_unavailable",
      immutable_reference_mutated: "immutable_reference_mutated", immutable_reference_path_unavailable: "immutable_reference_path_unavailable",
      immutable_reference_escaped: "immutable_reference_escaped", private_input_unavailable: "private_input_unavailable",
      publication_failed: "publication_failed", operation_conflict: "operation_conflict", operation_cancelled: "operation_cancelled", turn_failed: "turn_failed",
      deck_source_page_limit: "deck_source_page_limit",
    } satisfies Record<TurnErrorCode, TurnErrorCode>;
    const expected = Object.values(codes).map((code) => {
      const event = { id: code, ts: 10, type: "status.error" as const, code, message: "sanitized", recoverable: true };
      const stored = insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });
      return { sequence: stored.sequence, event };
    });

    // When / Then
    expect(listSequencedSessionEvents(sqlite, "s", 0)).toEqual(expected);
  });

  test("Given every shared rejection reason and a not-applied notice When replayed Then strict readers preserve them", () => {
    // Given: Record makes additions to the shared DTO require replay coverage.
    const reasons = {
      logo_manifest_missing: "logo_manifest_missing", logo_manifest_invalid: "logo_manifest_invalid",
      logo_history_changed: "logo_history_changed", logo_selection_invalid: "logo_selection_invalid",
      logo_candidate_invalid: "logo_candidate_invalid", logo_candidate_provenance: "logo_candidate_provenance",
      logo_svg_missing: "logo_svg_missing", logo_svg_invalid: "logo_svg_invalid",
      logo_svg_source_mismatch: "logo_svg_source_mismatch", logo_guidelines_invalid: "logo_guidelines_invalid",
      logo_directions_invalid: "logo_directions_invalid", logo_adoption_invalid: "logo_adoption_invalid",
      logo_reference_copied: "logo_reference_copied", logo_reference_similar: "logo_reference_similar",
      logo_screening_failed: "logo_screening_failed", logo_moodboard_changed: "logo_moodboard_changed",
    } satisfies Record<TurnRejectionReason, TurnRejectionReason>;
    const expected = Object.values(reasons).map((reason, index) => {
      const event = {
        id: reason, ts: 10, type: "status.error" as const, code: "logo_deliverables_missing" as const,
        message: "sanitized", recoverable: true, reason,
        notApplied: { turnId: `turn-${index}`, operationId: `op-${index}`, repairs: index % 2 },
      };
      const stored = insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });
      return { sequence: stored.sequence, event };
    });

    // When / Then: a reloaded conversation still knows the turn produced nothing.
    expect(listSequencedSessionEvents(sqlite, "s", 0)).toEqual(expected);
  });

  test.each([
    ["an unknown reason", { reason: "logo_vibes_wrong" }],
    ["an empty reason", { reason: "" }],
    ["a non-string reason", { reason: 7 }],
    ["a not-applied notice that is not an object", { notApplied: "yes" }],
    ["a not-applied array", { notApplied: [] }],
    ["a not-applied notice without an operation", { notApplied: { turnId: "t", repairs: 0 } }],
    ["a negative repair count", { notApplied: { turnId: "t", operationId: "o", repairs: -1 } }],
    ["a fractional repair count", { notApplied: { turnId: "t", operationId: "o", repairs: 0.5 } }],
  ])("Given %s persisted on a turn error When replayed Then corruption is rejected", (_label, claim) => {
    // Given
    const event = { id: "invalid-metadata", ts: 10, type: "status.error", message: "sanitized", recoverable: true, ...claim };
    insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });

    // When / Then
    expect(() => listSequencedSessionEvents(sqlite, "s", 0)).toThrow(new PipelineRepositoryError("corrupt_json", event.id));
  });

  test.each(["unknown_error", "", "toString", "__proto__", null, 7, {}])("Given invalid persisted error code %j When replayed Then corruption is rejected", (code) => {
    // Given
    const event = { id: "invalid-error", ts: 10, type: "status.error", code, message: "sanitized", recoverable: true };
    insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });

    // When / Then
    expect(() => listSequencedSessionEvents(sqlite, "s", 0)).toThrow(new PipelineRepositoryError("corrupt_json", event.id));
  });

  test("Given events share a millisecond When inserted Then sequence is monotonic and corrupted JSON is rejected with a machine code", () => {
    // Given / When
    const first = insertSequencedEvent(sqlite, { id: "e1", sessionId: "s", direction: "down", type: "x", payload: {}, turnId: null, processedAt: 10, createdAt: 10 });
    const second = insertSequencedEvent(sqlite, { id: "e2", sessionId: "s", direction: "down", type: "x", payload: {}, turnId: null, processedAt: 10, createdAt: 10 });
    sqlite.exec("INSERT INTO learning_checkpoints (id,item_id,project_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES ('cp','lesson','p',3,'project-digest','done','{',3)");

    // Then
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    try { getLearningCheckpoint(db, "cp"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
  });
});
