import type { Database } from "bun:sqlite";
import { parsePaletteTransferProof, type PaletteTransferProof } from "@bg/shared/palette";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import type { CatalogReceiptRow } from "./catalog-repository";
import { CanonicalTreeManifestError, parseCanonicalTreeManifest } from "../services/canonical-tree-manifest";
import { validateCanonicalTransferReceipt } from "./canonical-transfer-repository";
import { parseContentJournal, parseContentProvenance, SystemContentError } from "../services/system-content-format";

export class PaletteTransferRepositoryError extends Error {
  readonly name = "PaletteTransferRepositoryError";
  constructor(readonly code: "palette_transfer_corrupt" | "palette_transfer_conflict", readonly receiptId: string) { super(code); }
}
function corrupt(receiptId: string): never { throw new PaletteTransferRepositoryError("palette_transfer_corrupt", receiptId); }
function parseProof(input: unknown, receiptId: string): PaletteTransferProof {
  try { return parsePaletteTransferProof(input); }
  catch (error) { if (error instanceof UpgradeContractError) return corrupt(receiptId); throw error; }
}
function receiptById(db: Database, receiptId: string): CatalogReceiptRow | null {
  const statement = db.prepare<CatalogReceiptRow, [string]>(`SELECT id,design_system_id designSystemId,status,
    content_revision contentRevision,schema_version schemaVersion,digest,manifest_json manifestJson,
    provenance_json provenanceJson,operation,parent_system_id parentSystemId,parent_receipt_id parentReceiptId,
    parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath
    FROM design_system_receipts WHERE id=?`);
  try { return statement.get(receiptId); }
  finally { statement.finalize(); }
}
function bindManifest(db: Database, receipt: CatalogReceiptRow, proof: PaletteTransferProof): void {
  const copy = receipt.operation === "duplicate" || receipt.operation === "derive";
  let imported = false;
  if (receipt.operation === "content" && receipt.schemaVersion === 2 && receipt.contentRevision === 1) {
    try {
      const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
      const provenance = parseContentProvenance(JSON.parse(receipt.provenanceJson));
      imported = provenance.writer === "bundle-import" && provenance.source_extraction === null &&
        journal.mode === "create" && journal.base === null && journal.palette_history === null &&
        journal.intent === "publish" && journal.failure_code === null &&
        receipt.sourcePath === null && receipt.destinationPath !== null &&
        validateCanonicalTransferReceipt(db, receipt) !== null;
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof SystemContentError) return corrupt(receipt.id);
      throw error;
    }
  }
  if ((receipt.schemaVersion !== 1 && receipt.schemaVersion !== 2) ||
    !(receipt.operation === "content" && receipt.schemaVersion === 1 && receipt.contentRevision === 1 ||
      imported || copy && Number.isSafeInteger(receipt.contentRevision) && receipt.contentRevision < 0)) return corrupt(receipt.id);
  if (copy && (receipt.destinationPath === null || receipt.sourcePath === null || receipt.parentSystemId === null ||
    receipt.parentDigest !== receipt.digest)) return corrupt(receipt.id);
  try {
    const manifest = parseCanonicalTreeManifest(JSON.parse(receipt.manifestJson));
    if (receipt.schemaVersion === 2 && receipt.digest !== manifest.tree_digest) return corrupt(receipt.id);
    const files = manifest.files.filter(file => file.path.split("/")[0]?.normalize("NFC").toLowerCase() === "palette");
    if (files.length !== 2) return corrupt(receipt.id);
    for (const [name, member] of [["palette/state.json", proof.state], ["palette/scales.css", proof.css]] as const) {
      const file = files.find(file => file.path === name);
      if (file === undefined || file.size !== member.size_bytes || file.sha256 !== member.sha256) return corrupt(receipt.id);
    }
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof CanonicalTreeManifestError) return corrupt(receipt.id);
    throw error;
  }
}
/** Trusted prepare paths only. The caller owns the receipt/proof transaction. */
export function insertPaletteTransfer(db: Database, receiptId: string, input: PaletteTransferProof): void {
  const proof = parseProof(input, receiptId);
  const receipt = receiptById(db, receiptId);
  if (receipt === null || receipt.status !== "prepared") throw new PaletteTransferRepositoryError("palette_transfer_conflict", receiptId);
  bindManifest(db, receipt, proof);
  const statement = db.prepare(`INSERT INTO design_system_palette_transfers
    (receipt_id,proof_version,emitter_version,state_size_bytes,state_sha256,css_size_bytes,css_sha256)
    VALUES (?,?,?,?,?,?,?)`);
  try {
    statement.run(receiptId, proof.schema_version, proof.emitter_version,
      proof.state.size_bytes, proof.state.sha256, proof.css.size_bytes, proof.css.sha256);
  } catch (error) {
    if (error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      throw new PaletteTransferRepositoryError("palette_transfer_conflict", receiptId);
    }
    throw error;
  } finally { statement.finalize(); }
}
/** Reading storage does not activate a prepared, recovering, or failed receipt. */
export function readPaletteTransfer(db: Database, receiptId: string): PaletteTransferProof | null {
  const statement = db.prepare<{
    readonly proof_version: unknown; readonly emitter_version: unknown; readonly state_size_bytes: unknown;
    readonly state_sha256: unknown; readonly css_size_bytes: unknown; readonly css_sha256: unknown;
  }, [string]>(`SELECT proof_version,emitter_version,state_size_bytes,state_sha256,css_size_bytes,css_sha256
    FROM design_system_palette_transfers WHERE receipt_id=?`);
  try {
    const row = statement.get(receiptId);
    return row === null ? null : parseProof({ schema_version: row.proof_version, emitter_version: row.emitter_version,
      state: { size_bytes: row.state_size_bytes, sha256: row.state_sha256 },
      css: { size_bytes: row.css_size_bytes, sha256: row.css_sha256 } }, receiptId);
  } finally { statement.finalize(); }
}
/** DB/manifest binding only; the live ownership resolver separately requires committed ancestry. */
export function validatePaletteTransferReceipt(db: Database, receipt: CatalogReceiptRow): PaletteTransferProof | null {
  const proof = readPaletteTransfer(db, receipt.id);
  if (proof === null) return null;
  const stored = receiptById(db, receipt.id);
  const fields = ["id", "designSystemId", "status", "contentRevision", "schemaVersion", "digest", "manifestJson",
    "provenanceJson", "operation", "parentSystemId", "parentReceiptId", "parentDigest", "reason", "metadataJson",
    "sourcePath", "destinationPath"] as const;
  if (stored === null || fields.some(field => stored[field] !== receipt[field])) return corrupt(receipt.id);
  bindManifest(db, stored, proof);
  return proof;
}
