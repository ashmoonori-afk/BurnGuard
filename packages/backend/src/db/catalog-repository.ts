import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CatalogKind, CatalogLicense, CatalogProvenance, DesignSystemSourceType, ProjectType } from "@bg/shared";

export type CatalogRow = {
  readonly id: string; readonly name: string; readonly description: string | null;
  readonly status: "draft" | "review" | "published"; readonly sourceType: DesignSystemSourceType | null;
  readonly sourceUri: string | null; readonly isTemplate: number; readonly dirPath: string;
  readonly skillMdPath: string | null; readonly tokensCssPath: string | null; readonly readmeMdPath: string | null;
  readonly thumbnailPath: string | null; readonly createdAt: number; readonly updatedAt: number; readonly archivedAt: number | null;
  readonly metadataRevision: number; readonly kind: CatalogKind; readonly owner: "local";
  readonly lifecycle: "active" | "archived" | "trashed"; readonly provenance: CatalogProvenance;
  readonly license: CatalogLicense; readonly trashedAt: number | null;
};

export type CatalogReceiptRow = {
  readonly id: string; readonly designSystemId: string; readonly status: "prepared" | "committed" | "recovering" | "failed";
  readonly contentRevision: number; readonly schemaVersion: number; readonly digest: string;
  readonly manifestJson: string; readonly provenanceJson: string; readonly operation: "content" | "duplicate" | "derive" | "trash" | "restore" | "purge";
  readonly parentSystemId: string | null; readonly parentReceiptId: string | null; readonly parentDigest: string | null;
  readonly reason: string | null; readonly metadataJson: string; readonly sourcePath: string | null; readonly destinationPath: string | null;
};

type MetadataInput = {
  readonly id: string; readonly expectedRevision: number; readonly name: string; readonly description: string | null;
  readonly status: CatalogRow["status"]; readonly tags: readonly string[]; readonly kind: CatalogKind; readonly provenance: CatalogProvenance;
  readonly license: CatalogLicense; readonly lifecycle: "active" | "archived"; readonly updatedAt: number;
};

type OperationInput = {
  readonly systemId: string; readonly operation: Exclude<CatalogReceiptRow["operation"], "content">;
  readonly digest: string; readonly manifestJson: string; readonly provenanceJson: string;
  readonly parentSystemId: string | null; readonly parentReceiptId: string | null; readonly parentDigest: string | null;
  readonly reason: string | null; readonly metadata: Readonly<Record<string, string>>;
  readonly sourcePath: string; readonly destinationPath: string; readonly now: number;
};

export class CatalogRepositoryError extends Error {
  readonly name = "CatalogRepositoryError";
  constructor(readonly code: "not_found" | "expected_revision_conflict" | "id_conflict" | "operation_conflict", readonly entityId: string) {
    super(`${code}: ${entityId}`);
  }
}

export function listCatalogRows(db: Database): readonly CatalogRow[] {
  return db.query<CatalogRow, []>(`SELECT id,name,description,status,source_type sourceType,source_uri sourceUri,
    is_template isTemplate,dir_path dirPath,skill_md_path skillMdPath,tokens_css_path tokensCssPath,readme_md_path readmeMdPath,
    thumbnail_path thumbnailPath,created_at createdAt,updated_at updatedAt,archived_at archivedAt,
    metadata_revision metadataRevision,catalog_kind kind,catalog_owner owner,lifecycle,provenance_state provenance,
    license_state license,trashed_at trashedAt FROM design_systems ORDER BY id`).all();
}

export function getCatalogRow(db: Database, id: string): CatalogRow | null {
  return db.query<CatalogRow, [string]>(`SELECT id,name,description,status,source_type sourceType,source_uri sourceUri,
    is_template isTemplate,dir_path dirPath,skill_md_path skillMdPath,tokens_css_path tokensCssPath,readme_md_path readmeMdPath,
    thumbnail_path thumbnailPath,created_at createdAt,updated_at updatedAt,archived_at archivedAt,
    metadata_revision metadataRevision,catalog_kind kind,catalog_owner owner,lifecycle,provenance_state provenance,
    license_state license,trashed_at trashedAt FROM design_systems WHERE id=?`).get(id);
}

export function getCatalogTags(db: Database, id: string): readonly string[] {
  return db.query<{ readonly tag: string }, [string]>("SELECT tag FROM design_system_tags WHERE design_system_id=? ORDER BY ordinal").all(id).map((row) => row.tag);
}

export function getCatalogUsage(db: Database, id: string): readonly { readonly id: string; readonly name: string }[] {
  return db.query<{ readonly id: string; readonly name: string }, [string]>("SELECT id,name FROM projects WHERE design_system_id=? AND archived_at IS NULL ORDER BY id").all(id);
}

export function getCatalogPreviewProjects(db: Database, id: string) {
  return db.query<{ id: string; type: ProjectType; current_revision: number; current_digest: string }, [string]>(`
    SELECT id,type,current_revision,current_digest FROM (
      SELECT id,type,current_revision,current_digest,
        ROW_NUMBER() OVER (PARTITION BY type ORDER BY updated_at DESC,id) AS position
      FROM projects WHERE design_system_id=? AND archived_at IS NULL AND current_digest IS NOT NULL
    ) WHERE position=1`).all(id);
}

export function getContentReceipt(db: Database, id: string): CatalogReceiptRow | null {
  return db.query<CatalogReceiptRow, [string]>(`${RECEIPT_SELECT} WHERE design_system_id=? AND operation='content' ORDER BY content_revision DESC LIMIT 1`).get(id);
}

export function getLineageReceipt(db: Database, id: string): CatalogReceiptRow | null {
  return db.query<CatalogReceiptRow, [string]>(`${RECEIPT_SELECT} WHERE design_system_id=? AND operation IN ('duplicate','derive') AND status='committed' ORDER BY created_at DESC,id DESC LIMIT 1`).get(id);
}

export function listPendingCatalogReceipts(db: Database): readonly CatalogReceiptRow[] {
  return db.query<CatalogReceiptRow, []>(`${RECEIPT_SELECT} WHERE operation!='content' AND status IN ('prepared','recovering') ORDER BY design_system_id,created_at,id`).all();
}

export function getLatestCatalogOperation(db: Database, id: string, operation: CatalogReceiptRow["operation"]): CatalogReceiptRow | null {
  return db.query<CatalogReceiptRow, [string, string]>(`${RECEIPT_SELECT} WHERE design_system_id=? AND operation=? AND status='committed' ORDER BY created_at DESC,id DESC LIMIT 1`).get(id, operation);
}

export function updateCatalogMetadata(db: Database, input: MetadataInput): void {
  const tags = [...new Set(input.tags.map((tag) => tag.normalize("NFC").trim().toLowerCase()).filter(Boolean))].sort();
  db.transaction(() => {
    const changed = db.prepare(`UPDATE design_systems SET name=?,description=?,status=?,catalog_kind=?,provenance_state=?,license_state=?,lifecycle=?,archived_at=?,
      metadata_revision=metadata_revision+1,updated_at=? WHERE id=? AND metadata_revision=?`).run(
        input.name, input.description, input.status, input.kind, input.provenance, input.license, input.lifecycle,
        input.lifecycle === "archived" ? input.updatedAt : null, input.updatedAt, input.id, input.expectedRevision,
      ).changes;
    if (changed === 0) throw new CatalogRepositoryError("expected_revision_conflict", input.id);
    db.prepare("DELETE FROM design_system_tags WHERE design_system_id=?").run(input.id);
    const insert = db.prepare("INSERT INTO design_system_tags(design_system_id,tag,ordinal) VALUES (?,?,?)");
    tags.forEach((tag, ordinal) => insert.run(input.id, tag, ordinal));
  })();
}

export function createCatalogChild(db: Database, parent: CatalogRow, childId: string, name: string, input: OperationInput): string {
  const receiptId = `catalog-${input.operation}-${childId}-${randomUUID()}`;
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO design_systems(id,name,description,status,source_type,source_uri,is_template,dir_path,skill_md_path,tokens_css_path,readme_md_path,thumbnail_path,
        created_at,updated_at,metadata_revision,catalog_kind,catalog_owner,lifecycle,provenance_state,license_state)
        VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,0,?,'local','active',?,?)`).run(
          childId, name, parent.description, parent.status, parent.sourceType, parent.sourceUri, input.destinationPath,
          childPath(input.destinationPath, parent.skillMdPath), childPath(input.destinationPath, parent.tokensCssPath),
          childPath(input.destinationPath, parent.readmeMdPath), parent.thumbnailPath, input.now, input.now, parent.kind, parent.provenance, parent.license,
        );
      insertOperation(db, receiptId, input);
    })();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT") throw new CatalogRepositoryError("id_conflict", childId);
    throw error;
  }
  return receiptId;
}

export function prepareCatalogOperation(db: Database, input: OperationInput): string {
  const receiptId = `catalog-${input.operation}-${input.systemId}-${randomUUID()}`;
  try { insertOperation(db, receiptId, input); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT") throw new CatalogRepositoryError("operation_conflict", input.systemId);
    throw error;
  }
  return receiptId;
}

export function commitCatalogOperation(db: Database, receiptId: string, lifecycle: "active" | "trashed", now: number): void {
  db.transaction(() => {
    const receipt = db.query<{ readonly designSystemId: string; readonly operation: string }, [string]>("SELECT design_system_id designSystemId,operation FROM design_system_receipts WHERE id=? AND status IN ('prepared','recovering')").get(receiptId);
    if (receipt === null) throw new CatalogRepositoryError("operation_conflict", receiptId);
    db.prepare("UPDATE design_system_receipts SET status='committed',updated_at=? WHERE id=?").run(now, receiptId);
    db.prepare("UPDATE design_systems SET lifecycle=?,trashed_at=?,updated_at=? WHERE id=?").run(lifecycle, lifecycle === "trashed" ? now : null, now, receipt.designSystemId);
  })();
}

export function failCatalogOperation(db: Database, receiptId: string, now: number): void {
  db.prepare("UPDATE design_system_receipts SET status='failed',updated_at=? WHERE id=? AND status IN ('prepared','recovering')").run(now, receiptId);
}

export function deleteCatalogSystem(db: Database, id: string): void {
  db.prepare("DELETE FROM design_systems WHERE id=?").run(id);
}

function insertOperation(db: Database, receiptId: string, input: OperationInput): void {
  const ordinal = db.query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM design_system_receipts WHERE design_system_id=? AND operation!='content'").get(input.systemId)?.count ?? 0;
  db.prepare(`INSERT INTO design_system_receipts(id,design_system_id,status,content_revision,schema_version,digest,manifest_json,
    provenance_json,created_at,updated_at,operation,parent_system_id,parent_receipt_id,parent_digest,reason,metadata_json,source_path,destination_path)
    VALUES (?,?,'prepared',?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      receiptId, input.systemId, -(ordinal + 1), input.digest, input.manifestJson, input.provenanceJson,
      input.now, input.now, input.operation, input.parentSystemId, input.parentReceiptId, input.parentDigest,
      input.reason, JSON.stringify(input.metadata), input.sourcePath, input.destinationPath,
    );
}

function childPath(destination: string, parentPath: string | null): string | null {
  if (parentPath === null) return null;
  const fileName = parentPath.replaceAll("\\", "/").split("/").at(-1);
  return fileName === undefined ? null : path.join(destination, fileName);
}

const RECEIPT_SELECT = `SELECT id,design_system_id designSystemId,status,content_revision contentRevision,schema_version schemaVersion,
  digest,manifest_json manifestJson,provenance_json provenanceJson,operation,parent_system_id parentSystemId,
  parent_receipt_id parentReceiptId,parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath
  FROM design_system_receipts`;
