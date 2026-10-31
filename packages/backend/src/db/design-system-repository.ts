import { and, asc, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/bun-sqlite";
import { getCurrentSystemContent, getPendingSystemOperation } from "./catalog-repository";
import { PipelineRepositoryError, parseJsonRecord } from "./pipeline-repository";
import { designSystemReceiptsTable, designSystemTagsTable } from "./pipeline-schema";
import type { Database } from "bun:sqlite";
import { getCatalogRow, type CatalogReceiptRow, type CatalogRow } from "./catalog-repository";
import { parseContentJournal, parseContentProvenance, SystemContentError, type ContentBase, type ContentHead } from "../services/system-content-format";
import { parseCanonicalTreeManifest } from "../services/canonical-tree-manifest";
import { parsePaletteTransferProof, type PaletteTransferProof } from "@bg/shared/palette";
import { insertPaletteTransfer, readPaletteTransfer, validatePaletteTransferReceipt } from "./palette-transfer-repository";
import { parseCanonicalTransferProof, type CanonicalTransferProof } from "@bg/shared/theme";
import { insertCanonicalTransfer, readCanonicalTransfer, validateCanonicalTransferReceipt } from "./canonical-transfer-repository";

type MetadataUpdate = {
  readonly id: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly updatedAt: number;
};
type ReceiptInput = {
  readonly id: string;
  readonly designSystemId: string;
  readonly contentRevision: number;
  readonly schemaVersion: number;
  readonly digest: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly paletteTransfer?: PaletteTransferProof;
  readonly canonicalTransfer?: CanonicalTransferProof;
};
type Receipt = {
  readonly id: string;
  readonly contentRevision: number;
  readonly schemaVersion: number;
  readonly digest: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
};

type PipelineDatabase = ReturnType<typeof drizzle>;

export function updateDesignSystemMetadata(db: PipelineDatabase, input: MetadataUpdate) {
  const tags = [...new Set(input.tags.map((tag) => tag.normalize("NFC").trim().toLowerCase()).filter(Boolean))].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return db.transaction((tx) => {
    tx.run(sql`UPDATE design_systems SET name=${input.name}, description=${input.description}, metadata_revision=${input.expectedRevision + 1}, updated_at=${input.updatedAt} WHERE id=${input.id} AND metadata_revision=${input.expectedRevision}`);
    const changed = tx.get<readonly [number]>(sql`SELECT changes()`);
    if (changed?.[0] === 0) throw new PipelineRepositoryError("expected_revision_conflict", input.id);
    tx.delete(designSystemTagsTable).where(eq(designSystemTagsTable.designSystemId, input.id)).run();
    if (tags.length > 0) {
      tx.insert(designSystemTagsTable).values(tags.map((tag, ordinal) => ({ designSystemId: input.id, tag, ordinal }))).run();
    }
    return { id: input.id, metadataRevision: input.expectedRevision + 1, tags };
  });
}

export function prepareDesignSystemReceipt(db: PipelineDatabase, input: ReceiptInput): Receipt {
  return db.transaction((tx) => {
    const pending = getPendingSystemOperation(db.$client, input.designSystemId);
    if (pending !== null && pending.id !== input.id) throw new PipelineRepositoryError("content_receipt_mismatch", input.designSystemId);
    const current = tx.select().from(designSystemReceiptsTable).where(and(
      eq(designSystemReceiptsTable.designSystemId, input.designSystemId),
      eq(designSystemReceiptsTable.contentRevision, input.contentRevision),
    )).limit(1).all()[0];
    if (current !== undefined) {
      if (current.operation !== "content" || current.id !== input.id || current.digest !== input.digest || current.schemaVersion !== input.schemaVersion) {
        throw new PipelineRepositoryError("content_receipt_mismatch", input.designSystemId);
      }
      const storedProof = readPaletteTransfer(db.$client, current.id);
      const suppliedProof = input.paletteTransfer === undefined ? null : parsePaletteTransferProof(input.paletteTransfer);
      if (JSON.stringify(storedProof) !== JSON.stringify(suppliedProof)) {
        throw new PipelineRepositoryError("content_receipt_mismatch", input.designSystemId);
      }
      const storedCanonical = readCanonicalTransfer(db.$client, current.id);
      const suppliedCanonical = input.canonicalTransfer === undefined ? null : parseCanonicalTransferProof(input.canonicalTransfer);
      if (JSON.stringify(storedCanonical) !== JSON.stringify(suppliedCanonical)) {
        throw new PipelineRepositoryError("content_receipt_mismatch", input.designSystemId);
      }
      return parseReceipt(current);
    }
    tx.insert(designSystemReceiptsTable).values({
      id: input.id,
      designSystemId: input.designSystemId,
      status: "prepared",
      contentRevision: input.contentRevision,
      schemaVersion: input.schemaVersion,
      digest: input.digest,
      manifestJson: JSON.stringify(input.manifest),
      provenanceJson: JSON.stringify(input.provenance),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }).run();
    if (input.canonicalTransfer !== undefined) insertCanonicalTransfer(db.$client, input.id, input.canonicalTransfer);
    if (input.paletteTransfer !== undefined) insertPaletteTransfer(db.$client, input.id, input.paletteTransfer);
    return { id: input.id, contentRevision: input.contentRevision, schemaVersion: input.schemaVersion, digest: input.digest, manifest: input.manifest, provenance: input.provenance };
  });
}

export function commitDesignSystemReceipt(db: PipelineDatabase, input: { readonly id: string; readonly digest: string; readonly updatedAt: number }): Receipt {
  return db.transaction((tx) => {
    const row = db.$client.query<CatalogReceiptRow, [string, string]>(`${SYSTEM_CONTENT_SELECT}
      WHERE id=? AND digest=? AND operation='content' AND status IN ('prepared','recovering')`).get(input.id, input.digest);
    if (row === null) throw new PipelineRepositoryError("content_receipt_mismatch", input.id);
    validatePaletteTransferReceipt(db.$client, row);
    validateCanonicalTransferReceipt(db.$client, row);
    tx.update(designSystemReceiptsTable).set({ status: "committed", updatedAt: input.updatedAt }).where(and(
      eq(designSystemReceiptsTable.id, input.id),
      eq(designSystemReceiptsTable.operation, "content"),
      sql`${designSystemReceiptsTable.status} IN ('prepared','recovering')`,
      eq(designSystemReceiptsTable.digest, input.digest),
    )).run();
    const changed = tx.get<readonly [number]>(sql`SELECT changes()`);
    if (changed?.[0] !== 1) throw new PipelineRepositoryError("content_receipt_mismatch", input.id);
    return parseReceipt(row);
  });
}

export function getDesignSystemReceiptById(db: PipelineDatabase, id: string): Receipt | null {
  const row = db.select().from(designSystemReceiptsTable).where(and(
    eq(designSystemReceiptsTable.id, id),
    eq(designSystemReceiptsTable.status, "committed"),
    eq(designSystemReceiptsTable.operation, "content"),
  )).limit(1).all()[0];
  return row === undefined ? null : parseReceipt(row);
}

export function getDesignSystemPipeline(db: PipelineDatabase, id: string): { readonly metadataRevision: number; readonly tags: readonly string[]; readonly receipt: Receipt | null } {
  const system = db.get<readonly [number]>(sql`SELECT metadata_revision FROM design_systems WHERE id=${id}`);
  if (system === undefined) throw new PipelineRepositoryError("not_found", id);
  const tags = db.select({ tag: designSystemTagsTable.tag }).from(designSystemTagsTable).where(eq(designSystemTagsTable.designSystemId, id)).orderBy(asc(designSystemTagsTable.ordinal)).all().map((row) => row.tag);
  if (tags.some((tag) => tag.length === 0 || tag.trim() !== tag || tag.normalize("NFC") !== tag)) {
    throw new PipelineRepositoryError("corrupt_tag", id);
  }
  const row = getCurrentSystemContent(db.$client, id);
  return { metadataRevision: system[0], tags, receipt: row === null ? null : parseReceipt(row) };
}

function parseReceipt(row: Pick<typeof designSystemReceiptsTable.$inferSelect, "id" | "contentRevision" | "schemaVersion" | "digest" | "manifestJson" | "provenanceJson">): Receipt {
  return {
    id: row.id,
    contentRevision: row.contentRevision,
    schemaVersion: row.schemaVersion,
    digest: row.digest,
    manifest: parseJsonRecord(row.manifestJson, row.id),
    provenance: parseJsonRecord(row.provenanceJson, row.id),
  };
}

export function systemContentHead(db: Database, id: string): ContentHead | null {
  const row = getCurrentSystemContent(db, id);
  if (row === null) return null;
  if (row.schemaVersion !== 1 && row.schemaVersion !== 2) throw new SystemContentError("system_content_corrupt");
  return { receipt_id: row.id, revision: row.contentRevision, schema_version: row.schemaVersion, digest: row.digest };
}

export function assertSystemContentAuthority(db: Database, id: string, base: ContentBase | null, createPrepared = false): void {
  const row = getCatalogRow(db, id);
  if (base === null) {
    if (createPrepared ? row === null || row.metadataRevision !== 0 || row.lifecycle !== "active" : row !== null) throw new SystemContentError("system_content_conflict");
  } else if (row === null || row.metadataRevision !== base.metadata_revision || row.lifecycle !== base.lifecycle) {
    throw new SystemContentError("system_content_conflict");
  }
  if (JSON.stringify(systemContentHead(db, id)) !== JSON.stringify(base?.head ?? null)) throw new SystemContentError("system_content_conflict");
}

export function getSystemContentReceipt(db: Database, id: string): CatalogReceiptRow | null {
  return db.query<CatalogReceiptRow, [string]>(`${SYSTEM_CONTENT_SELECT} WHERE id=? AND operation='content' AND schema_version=2`).get(id);
}
export function listSystemContentReceipts(db: Database): readonly CatalogReceiptRow[] {
  return db.query<CatalogReceiptRow, []>(`${SYSTEM_CONTENT_SELECT} WHERE operation='content' AND schema_version=2 ORDER BY design_system_id,content_revision`).all();
}
export type NewContentSystem = {
  readonly name: string; readonly description: string | null;
  readonly skillMdPath: string | null; readonly tokensCssPath: string | null; readonly readmeMdPath: string | null;
};

/** Stage is complete before this transaction; no placeholder candidate can become durable. */
export function prepareSystemContent(db: Database, input: {
  readonly id: string; readonly journal: unknown; readonly manifest: unknown; readonly provenance: unknown;
  readonly live: string; readonly now: number; readonly create: NewContentSystem | null;
  readonly canonicalTransfer?: CanonicalTransferProof;
}): CatalogReceiptRow {
  const journal = parseContentJournal(input.journal);
  const manifest = parseCanonicalTreeManifest(input.manifest);
  const provenance = parseContentProvenance(input.provenance);
  if (input.id !== `system-content-${journal.operation_id}` || journal.cleanup !== "pending" || journal.intent !== "publish" || journal.failure_code !== null || (journal.mode === "create") !== (input.create !== null) || (provenance.writer === "palette") !== (journal.palette_history !== null)) throw new SystemContentError("system_content_corrupt");
  db.transaction(() => {
    assertSystemContentAuthority(db, journal.system_id, journal.base);
    if (getPendingSystemOperation(db, journal.system_id) !== null) throw new SystemContentError("system_content_conflict");
    if (input.create !== null) {
      db.query(`INSERT INTO design_systems(id,name,description,status,source_type,is_template,dir_path,skill_md_path,tokens_css_path,readme_md_path,created_at,updated_at)
        VALUES (?,?,?,'draft','manual',0,?,?,?,?,?,?)`).run(journal.system_id, input.create.name, input.create.description, input.live, input.create.skillMdPath, input.create.tokensCssPath, input.create.readmeMdPath, input.now, input.now);
    }
    const revision = db.query<{ readonly revision: number }, [string]>("SELECT COALESCE(MAX(content_revision),0)+1 revision FROM design_system_receipts WHERE design_system_id=? AND content_revision>0").get(journal.system_id)?.revision;
    if (revision === undefined || !Number.isSafeInteger(revision) || revision < 1) throw new SystemContentError("system_content_corrupt");
    db.query(`INSERT INTO design_system_receipts(id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at,operation,parent_system_id,parent_receipt_id,parent_digest,metadata_json,source_path,destination_path)
      VALUES (?,?,'prepared',?,2,?,?,?,?,?,'content',?,?,?,?,?,?)`).run(
      input.id, journal.system_id, revision, manifest.tree_digest, JSON.stringify(manifest), JSON.stringify(provenance), input.now, input.now,
      journal.base?.head === null || journal.base === null ? null : journal.system_id,
      journal.base?.head?.receipt_id ?? null, journal.base?.head?.digest ?? null, JSON.stringify(journal),
      journal.mode === "replace" ? input.live : null, input.live,
    );
    if (input.canonicalTransfer !== undefined) insertCanonicalTransfer(db, input.id, input.canonicalTransfer);
  })();
  const result = getSystemContentReceipt(db, input.id);
  if (result === null) throw new SystemContentError("system_content_corrupt");
  return result;
}

/** The outer bundle import already owns this fresh row and its published candidate. */
export function prepareImportedSystemContent(db: Database, input: {
  readonly id: string; readonly journal: unknown; readonly manifest: unknown; readonly live: string;
  readonly now: number; readonly row: CatalogRow;
  readonly canonicalTransfer: CanonicalTransferProof; readonly paletteTransfer: PaletteTransferProof;
}): CatalogReceiptRow {
  const journal = parseContentJournal(input.journal);
  const manifest = parseCanonicalTreeManifest(input.manifest);
  const provenance = parseContentProvenance({ format: "system-content-v1", writer: "bundle-import", source_extraction: null });
  if (input.id !== `system-content-${journal.operation_id}` || journal.system_id !== input.row.id ||
    journal.mode !== "create" || journal.base !== null || journal.intent !== "publish" ||
    journal.cleanup !== "pending" || journal.failure_code !== null || journal.palette_history !== null ||
    input.row.dirPath !== input.live) throw new SystemContentError("system_content_corrupt");
  db.transaction(() => {
    assertSystemContentAuthority(db, journal.system_id, null, true);
    if (JSON.stringify(getCatalogRow(db, journal.system_id)) !== JSON.stringify(input.row)) {
      throw new SystemContentError("system_content_conflict");
    }
    const existing = db.prepare("SELECT 1 FROM design_system_receipts WHERE design_system_id=? LIMIT 1");
    try {
      if (existing.get(journal.system_id) !== null) throw new SystemContentError("system_content_conflict");
    } finally { existing.finalize(); }
    const insert = db.prepare(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,
       created_at,updated_at,operation,metadata_json,destination_path)
      VALUES (?,?,'prepared',1,2,?,?,?,?,?,'content',?,?)`);
    try {
      insert.run(input.id, journal.system_id, manifest.tree_digest, JSON.stringify(manifest),
        JSON.stringify(provenance), input.now, input.now, JSON.stringify(journal), input.live);
    } finally { insert.finalize(); }
    insertCanonicalTransfer(db, input.id, input.canonicalTransfer);
    insertPaletteTransfer(db, input.id, input.paletteTransfer);
  })();
  const result = getSystemContentReceipt(db, input.id);
  if (result === null) throw new SystemContentError("system_content_corrupt");
  return result;
}

export function commitSystemContent(db: Database, receipt: CatalogReceiptRow, now: number): void {
  const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
  if (journal.intent !== "publish") throw new SystemContentError("system_content_conflict");
  db.transaction(() => {
    assertSystemContentAuthority(db, journal.system_id, journal.base, journal.mode === "create");
    if (getPendingSystemOperation(db, journal.system_id)?.id !== receipt.id) throw new SystemContentError("system_content_conflict");
    validateCanonicalTransferReceipt(db, receipt);
    validatePaletteTransferReceipt(db, receipt);
    const changed = db.query(`UPDATE design_system_receipts SET status='committed',updated_at=? WHERE id=? AND schema_version=2 AND operation='content'
      AND status IN ('prepared','recovering') AND digest=? AND metadata_json=? AND manifest_json=? AND provenance_json=?`).run(now, receipt.id, receipt.digest, receipt.metadataJson, receipt.manifestJson, receipt.provenanceJson).changes;
    if (changed !== 1) throw new SystemContentError("system_content_conflict");
    if (db.query("UPDATE design_systems SET updated_at=? WHERE id=?").run(now, journal.system_id).changes !== 1) throw new SystemContentError("system_content_conflict");
  })();
}
/** Every journal transition uses the exact previous bytes as its compare-and-swap token. */
export function transitionSystemContent(db: Database, receipt: CatalogReceiptRow, journal: unknown, status: CatalogReceiptRow["status"], now: number): CatalogReceiptRow {
  const parsed = parseContentJournal(journal);
  const before = parseContentJournal(JSON.parse(receipt.metadataJson));
  const immutable = (value: typeof parsed) => JSON.stringify({ ...value, intent: "publish", cleanup: "pending", failure_code: null });
  if (immutable(parsed) !== immutable(before) || before.intent === "rollback" && parsed.intent !== "rollback" ||
    before.cleanup === "complete" && parsed.cleanup !== "complete" || status === "committed" && receipt.status !== "committed" ||
    status === "failed" && parsed.intent !== "rollback" || parsed.cleanup === "complete" && status !== "committed" && status !== "failed" &&
      !(parsed.mode === "create" && parsed.intent === "rollback" && (status === "prepared" || status === "recovering"))) throw new SystemContentError("system_content_corrupt");
  if (receipt.status === "committed" && status !== "committed" || receipt.status === "failed" && status !== "failed") throw new SystemContentError("system_content_conflict");
  const changed = db.query(`UPDATE design_system_receipts SET metadata_json=?,status=?,updated_at=? WHERE id=? AND status=? AND metadata_json=?
    AND schema_version=2 AND operation='content' AND digest=?`).run(JSON.stringify(parsed), status, now, receipt.id, receipt.status, receipt.metadataJson, receipt.digest).changes;
  if (changed !== 1) throw new SystemContentError("system_content_conflict");
  const result = getSystemContentReceipt(db, receipt.id);
  if (result === null) throw new SystemContentError("system_content_corrupt");
  return result;
}
/** Create rollback deletes its own reservation only after all owned storage was removed. */
export function removeRolledBackContentCreate(db: Database, receipt: CatalogReceiptRow): void {
  const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
  if (journal.mode !== "create" || journal.intent !== "rollback" || receipt.status === "committed" || journal.cleanup !== "complete") throw new SystemContentError("system_content_conflict");
  db.transaction(() => {
    assertSystemContentAuthority(db, journal.system_id, null, true);
    const current = getSystemContentReceipt(db, receipt.id);
    const pending = getPendingSystemOperation(db, journal.system_id);
    if (current?.metadataJson !== receipt.metadataJson || current.status !== receipt.status || pending !== null && pending.id !== receipt.id) throw new SystemContentError("system_content_conflict");
    db.query(`DELETE FROM design_systems WHERE id=? AND metadata_revision=0
      AND NOT EXISTS (SELECT 1 FROM design_system_receipts WHERE design_system_id=? AND id!=?)`)
      .run(journal.system_id, journal.system_id, receipt.id);
    // Bun's statement count includes cascaded receipts; SQL changes() counts the one owned system row.
    if (db.query<{ readonly changes: number }, []>("SELECT changes() changes").get()?.changes !== 1) throw new SystemContentError("system_content_conflict");
  })();
}
const SYSTEM_CONTENT_SELECT = `SELECT id,design_system_id designSystemId,status,content_revision contentRevision,schema_version schemaVersion,
  digest,manifest_json manifestJson,provenance_json provenanceJson,operation,parent_system_id parentSystemId,parent_receipt_id parentReceiptId,
  parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath FROM design_system_receipts`;
