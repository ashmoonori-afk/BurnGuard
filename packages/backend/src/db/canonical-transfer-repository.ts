import type { Database } from "bun:sqlite";
import { parseCanonicalTransferProof, type CanonicalTransferProof } from "@bg/shared/theme";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import type { CatalogReceiptRow } from "./catalog-repository";
import { CanonicalTreeManifestError, parseCanonicalTreeManifest } from "../services/canonical-tree-manifest";
import { parseContentJournal, parseContentProvenance, SystemContentError } from "../services/system-content-format";

export class CanonicalTransferRepositoryError extends Error {
  readonly name = "CanonicalTransferRepositoryError";
  constructor(readonly code: "canonical_transfer_corrupt" | "canonical_transfer_conflict", readonly receiptId: string) { super(code); }
}
function corrupt(id: string): never { throw new CanonicalTransferRepositoryError("canonical_transfer_corrupt", id); }
function parseProof(input: unknown, id: string): CanonicalTransferProof {
  try { return parseCanonicalTransferProof(input); }
  catch (error) { if (error instanceof UpgradeContractError) return corrupt(id); throw error; }
}
function receiptById(db: Database, id: string): CatalogReceiptRow | null {
  const statement = db.prepare<CatalogReceiptRow, [string]>(`SELECT id,design_system_id designSystemId,status,
    content_revision contentRevision,schema_version schemaVersion,digest,manifest_json manifestJson,
    provenance_json provenanceJson,operation,parent_system_id parentSystemId,parent_receipt_id parentReceiptId,
    parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath
    FROM design_system_receipts WHERE id=?`);
  try { return statement.get(id); }
  finally { statement.finalize(); }
}
function bindManifest(receipt: CatalogReceiptRow, proof: CanonicalTransferProof): void {
  const copy = receipt.operation === "duplicate" || receipt.operation === "derive";
  const content = receipt.operation === "content";
  if ((receipt.schemaVersion !== 1 && receipt.schemaVersion !== 2) || !Number.isSafeInteger(receipt.contentRevision) ||
    !(copy && receipt.contentRevision < 0 || content && (receipt.schemaVersion === 1 ? receipt.contentRevision === 1 : receipt.contentRevision >= 1))) return corrupt(receipt.id);
  if (copy && (receipt.destinationPath === null || receipt.sourcePath === null || receipt.parentSystemId === null ||
    receipt.parentDigest !== receipt.digest)) return corrupt(receipt.id);
  try {
    const manifest = parseCanonicalTreeManifest(JSON.parse(receipt.manifestJson));
    if (receipt.schemaVersion === 2 && receipt.digest !== manifest.tree_digest) return corrupt(receipt.id);
    if (content && receipt.schemaVersion === 2) {
      const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
      const provenance = parseContentProvenance(JSON.parse(receipt.provenanceJson));
      if (!["palette", "canonical", "brand-image", "bundle-import", "bundled-addition"].includes(provenance.writer) ||
        receipt.id !== `system-content-${journal.operation_id}` || receipt.designSystemId !== journal.system_id ||
        receipt.parentReceiptId !== (journal.base?.head?.receipt_id ?? null) ||
        receipt.parentDigest !== (journal.base?.head?.digest ?? null) ||
        receipt.parentSystemId !== (journal.base?.head == null ? null : journal.system_id) ||
        (provenance.writer === "palette") !== (journal.palette_history !== null)) return corrupt(receipt.id);
    }
    const files = manifest.files.filter(file => file.path.split("/")[0]?.normalize("NFC").toLowerCase() === "canonical");
    if (files.length !== 3) return corrupt(receipt.id);
    for (const [name, member] of [["canonical/theme.json", proof.json], ["canonical/theme.css", proof.css], ["canonical/SKILL.md", proof.skill]] as const) {
      const file = files.find(entry => entry.path === name);
      if (file === undefined || file.size !== member.size_bytes || file.sha256 !== member.sha256) return corrupt(receipt.id);
    }
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof CanonicalTreeManifestError || error instanceof SystemContentError) return corrupt(receipt.id);
    throw error;
  }
}
/** Only trusted prepare paths call this inside their receipt transaction. */
export function insertCanonicalTransfer(db: Database, id: string, input: CanonicalTransferProof): void {
  const proof = parseProof(input, id), receipt = receiptById(db, id);
  if (receipt === null || receipt.status !== "prepared") throw new CanonicalTransferRepositoryError("canonical_transfer_conflict", id);
  bindManifest(receipt, proof);
  const statement = db.prepare(`INSERT INTO design_system_canonical_transfers
    (receipt_id,proof_version,emitter_version,json_size_bytes,json_sha256,css_size_bytes,css_sha256,skill_size_bytes,skill_sha256)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  try {
    statement.run(id, proof.schema_version, proof.emitter_version,
      proof.json.size_bytes, proof.json.sha256, proof.css.size_bytes, proof.css.sha256, proof.skill.size_bytes, proof.skill.sha256);
  } catch (error) {
    if (error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      throw new CanonicalTransferRepositoryError("canonical_transfer_conflict", id);
    }
    throw error;
  } finally { statement.finalize(); }
}
/** Stored declarations do not activate pending or failed owners. */
export function readCanonicalTransfer(db: Database, id: string): CanonicalTransferProof | null {
  const statement = db.prepare<{
    readonly proof_version: unknown; readonly emitter_version: unknown;
    readonly json_size_bytes: unknown; readonly json_sha256: unknown;
    readonly css_size_bytes: unknown; readonly css_sha256: unknown;
    readonly skill_size_bytes: unknown; readonly skill_sha256: unknown;
  }, [string]>(`SELECT proof_version,emitter_version,json_size_bytes,json_sha256,css_size_bytes,css_sha256,skill_size_bytes,skill_sha256
    FROM design_system_canonical_transfers WHERE receipt_id=?`);
  try {
    const row = statement.get(id);
    return row === null ? null : parseProof({ schema_version: row.proof_version, emitter_version: row.emitter_version,
      json: { size_bytes: row.json_size_bytes, sha256: row.json_sha256 },
      css: { size_bytes: row.css_size_bytes, sha256: row.css_sha256 },
      skill: { size_bytes: row.skill_size_bytes, sha256: row.skill_sha256 } }, id);
  } finally { statement.finalize(); }
}
/** Full receipt/manifest binding; live authority still requires committed ancestry. */
export function validateCanonicalTransferReceipt(db: Database, receipt: CatalogReceiptRow): CanonicalTransferProof | null {
  const proof = readCanonicalTransfer(db, receipt.id);
  if (proof === null) return null;
  const stored = receiptById(db, receipt.id);
  const fields = ["id", "designSystemId", "status", "contentRevision", "schemaVersion", "digest", "manifestJson",
    "provenanceJson", "operation", "parentSystemId", "parentReceiptId", "parentDigest", "reason", "metadataJson",
    "sourcePath", "destinationPath"] as const;
  if (stored === null || fields.some(field => stored[field] !== receipt[field])) return corrupt(receipt.id);
  bindManifest(stored, proof);
  return proof;
}
