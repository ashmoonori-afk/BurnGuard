import type { Database } from "bun:sqlite";
import type { CatalogReceiptRow } from "./catalog-repository";

export const RECEIPT_SELECT = `SELECT id,design_system_id designSystemId,status,content_revision contentRevision,schema_version schemaVersion,
  digest,manifest_json manifestJson,provenance_json provenanceJson,operation,parent_system_id parentSystemId,
  parent_receipt_id parentReceiptId,parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath
  FROM design_system_receipts`;

/** Raw storage only; each caller owns its receipt and ancestry admission rules. */
export function getCatalogReceiptById(db: Database, id: string): CatalogReceiptRow | null {
  const statement = db.prepare<CatalogReceiptRow, [string]>(`${RECEIPT_SELECT} WHERE id=?`);
  try { return statement.get(id); }
  finally { statement.finalize(); }
}
