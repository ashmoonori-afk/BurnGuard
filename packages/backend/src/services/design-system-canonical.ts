import type { DesignSystemCanonicalResponse } from "@bg/shared/theme";
import { getCurrentSystemContent, type CatalogReceiptRow } from "../db/catalog-repository";
import { CanonicalTransferRepositoryError, validateCanonicalTransferReceipt } from "../db/canonical-transfer-repository";
import { PathBoundaryError } from "../security/path-boundary";
import { bundledThemeHistory, themeAdditiveDigest, themeFileHash } from "./bundled-theme-refresh";
import { CanonicalTreeManifestError, parseCanonicalTreeManifest } from "./canonical-tree-manifest";
import { parseContentJournal, parseContentProvenance, SystemContentError } from "./system-content-format";
import { assertSystemContentLease, withSystemContentAccess, type SystemContentLease } from "./system-content-access";
import { contentObservationDigest, observeSystemContent, type ContentEnvironment, type ContentObservation } from "./system-content-publication";
import { safeContentChild } from "./system-content-tree";
import { readCanonicalCandidate, matchCanonicalTransfer, type CanonicalSnapshot } from "./canonical-theme-files";

function corrupt(): never { throw new SystemContentError("system_content_corrupt"); }
function unavailable(): never { throw new SystemContentError("system_content_unavailable"); }

export async function readDesignSystemCanonical(id: string, env: ContentEnvironment): Promise<DesignSystemCanonicalResponse | null> {
  return withSystemContentAccess(env.db, env.systemsRoot, [id], async lease => {
    const base = await observeSystemContent(env, id, lease);
    if (base.row === null) return null;
    const snapshot = await readOwnedCanonical(env, base, lease);
    const metadata = {
      expected_digest: contentObservationDigest(base),
      content_revision: base.head?.revision ?? 0,
      receipt_id: base.head?.receipt_id ?? null,
    };
    return snapshot === null ? { ...metadata, theme: null, css: null }
      : { ...metadata, theme: snapshot.theme, css: snapshot.css };
  });
}

function hasReceiptOwnership(env: ContentEnvironment, base: ContentObservation, snapshot: CanonicalSnapshot): boolean {
  let receipt: CatalogReceiptRow | null = getCurrentSystemContent(env.db, base.systemId);
  const seen = new Set<string>();
  while (receipt !== null) {
    if (seen.has(receipt.id) || seen.size >= 10000 || receipt.status !== "committed" || receipt.designSystemId !== base.systemId ||
      (receipt.schemaVersion !== 1 && receipt.schemaVersion !== 2)) return corrupt();
    seen.add(receipt.id);
    const proof = validateCanonicalTransferReceipt(env.db, receipt);
    if (proof !== null) {
      if (receipt.destinationPath !== null && receipt.destinationPath !== base.live) return corrupt();
      matchCanonicalTransfer(snapshot, proof);
      return true;
    }
    if (receipt.operation === "duplicate" || receipt.operation === "derive" || receipt.schemaVersion === 1) return false;
    if (receipt.operation !== "content" || !Number.isSafeInteger(receipt.contentRevision) || receipt.contentRevision < 1) return corrupt();
    const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
    const provenance = parseContentProvenance(JSON.parse(receipt.provenanceJson));
    const manifest = parseCanonicalTreeManifest(JSON.parse(receipt.manifestJson));
    const head = journal.base?.head ?? null;
    if (journal.system_id !== base.systemId || receipt.id !== `system-content-${journal.operation_id}` ||
      receipt.digest !== manifest.tree_digest || journal.intent !== "publish" || journal.failure_code !== null ||
      receipt.destinationPath !== base.live || receipt.sourcePath !== (journal.mode === "replace" ? base.live : null) ||
      receipt.parentReceiptId !== (head?.receipt_id ?? null) || receipt.parentDigest !== (head?.digest ?? null) ||
      receipt.parentSystemId !== (head === null ? null : base.systemId) ||
      (provenance.writer === "palette") !== (journal.palette_history !== null)) return corrupt();
    if (receipt.parentReceiptId === null) return false;
    const statement = env.db.prepare<CatalogReceiptRow, [string]>(`SELECT id,design_system_id designSystemId,status,
      content_revision contentRevision,schema_version schemaVersion,digest,manifest_json manifestJson,
      provenance_json provenanceJson,operation,parent_system_id parentSystemId,parent_receipt_id parentReceiptId,
      parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath
      FROM design_system_receipts WHERE id=?`);
    let parent: CatalogReceiptRow | null;
    try { parent = statement.get(receipt.parentReceiptId); }
    finally { statement.finalize(); }
    if (parent === null || head === null || parent.digest !== head.digest || parent.designSystemId !== base.systemId ||
      parent.contentRevision !== head.revision || parent.schemaVersion !== head.schema_version ||
      JSON.stringify(parseCanonicalTreeManifest(JSON.parse(parent.manifestJson))) !== JSON.stringify(journal.base?.manifest)) return corrupt();
    receipt = parent;
  }
  return false;
}

/** The caller must obtain the observation under its genuine system-content lease. */
export async function readOwnedCanonical(env: ContentEnvironment, base: ContentObservation, lease: SystemContentLease): Promise<CanonicalSnapshot | null> {
  assertSystemContentLease(lease, env.systemsRoot, base.systemId);
  if (base.row === null || base.tree === null) return null;
  if (base.row.lifecycle !== "active") return unavailable();
  try {
    if (base.live !== await safeContentChild(env.systemsRoot, base.systemId)) return corrupt();
    const snapshot = await readCanonicalCandidate(base.live, base.tree);
    if (snapshot === null) return null;
    if (hasReceiptOwnership(env, base, snapshot)) return snapshot;
    const slug = base.systemId.startsWith("builtin-theme-") ? base.systemId.slice("builtin-theme-".length) : null;
    const files = new Map([
      ["canonical/theme.json", themeFileHash(Buffer.from(snapshot.json))],
      ["canonical/theme.css", themeFileHash(Buffer.from(snapshot.css))],
      ["canonical/SKILL.md", themeFileHash(Buffer.from(snapshot.skill))],
    ]);
    if (slug === null || !(bundledThemeHistory.additive?.[slug]?.canonical ?? []).includes(themeAdditiveDigest(files, "canonical"))) return unavailable();
    return snapshot;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof PathBoundaryError || error instanceof CanonicalTreeManifestError ||
      error instanceof CanonicalTransferRepositoryError) return corrupt();
    throw error;
  }
}
