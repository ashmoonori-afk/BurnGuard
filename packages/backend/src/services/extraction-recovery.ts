import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { commitDesignSystemReceipt } from "../db/design-system-repository";
import { getDb, getSqlite } from "../db/client";
import { readPaletteTransfer } from "../db/palette-transfer-repository";
import { readCanonicalTransfer } from "../db/canonical-transfer-repository";
import { resolveManagedPath, systemsDir } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";
import { parseCanonicalTreeManifest, validateCanonicalTree } from "./canonical-tree-manifest";
import { classifyExtractionRecovery, type ExtractionRecoverySnapshot } from "./extraction-recovery-state";
import { validatePaletteTransferAtRoot } from "./design-system-palette";
import { validateCanonicalTransferAtRoot } from "./canonical-theme-files";
import {
  completeExtractionPublication,
  publishExtractionBundle,
  reconcileExtractionPublications,
  validateExtractionBundle,
  type ExtractionReservation,
} from "./extraction-publication";

export type ExtractionRecoveryReceipt = {
  readonly committed: number;
  readonly failed: number;
  readonly removed_staging: number;
  readonly removed_reservations: number;
};

type RecoveringRow = {
  readonly receiptId: string;
  readonly designSystemId: string;
  readonly digest: string;
  readonly manifestJson: string;
  readonly dirPath: string;
};

export async function reconcileExtractionState(now = Date.now()): Promise<ExtractionRecoveryReceipt> {
  const rows = getSqlite().query<RecoveringRow, []>(`
    SELECT r.id AS receiptId, r.design_system_id AS designSystemId,
           r.digest AS digest, r.manifest_json AS manifestJson, d.dir_path AS dirPath
      FROM design_system_receipts r
      JOIN design_systems d ON d.id = r.design_system_id
     WHERE r.operation = 'content' AND r.schema_version = 1 AND r.status IN ('prepared','recovering')
       AND NOT EXISTS (
         SELECT 1 FROM design_system_receipts newer
          WHERE newer.design_system_id = r.design_system_id
            AND (newer.schema_version != 1 OR newer.operation IN ('derive','duplicate'))
       )
     ORDER BY r.design_system_id, r.content_revision
  `).all();
  let committed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const destinationDir = resolveManagedPath(systemsDir, row.dirPath);
      if (destinationDir !== path.join(systemsDir, row.designSystemId)) {
        throw new ExtractionRecoveryError("noncanonical_destination");
      }
      const reservation = await recoveryReservation(row.designSystemId, destinationDir);
      const manifest = parseCanonicalTreeManifest(JSON.parse(row.manifestJson));
      const paletteTransfer = readPaletteTransfer(getSqlite(), row.receiptId);
      const canonicalTransfer = readCanonicalTransfer(getSqlite(), row.receiptId);
      const destinationExists = await stat(destinationDir).then((item) => item.isDirectory()).catch(() => false);
      if (!destinationExists) {
        if (reservation.stagingDir === destinationDir) throw new ExtractionRecoveryError("staging_missing");
        const sidecar = await validateExtractionBundle(reservation);
        if (sidecar.content_digest !== row.digest || sidecar.manifest.tree_digest !== manifest.tree_digest) throw new ExtractionRecoveryError("digest_mismatch");
        await validateCanonicalTree(reservation.stagingDir, manifest);
        if (paletteTransfer !== null) await validatePaletteTransferAtRoot(reservation.stagingDir, paletteTransfer);
        if (canonicalTransfer !== null) await validateCanonicalTransferAtRoot(reservation.stagingDir, canonicalTransfer);
        await publishExtractionBundle(reservation, undefined, manifest);
      }
      const published = { ...reservation, stagingDir: destinationDir } satisfies ExtractionReservation;
      const sidecar = await validateExtractionBundle(published);
      if (sidecar.content_digest !== row.digest) throw new ExtractionRecoveryError("digest_mismatch");
      await validateCanonicalTree(destinationDir, manifest);
      if (paletteTransfer !== null) await validatePaletteTransferAtRoot(destinationDir, paletteTransfer);
      if (canonicalTransfer !== null) await validateCanonicalTransferAtRoot(destinationDir, canonicalTransfer);
      commitDesignSystemReceipt(getDb(), { id: row.receiptId, digest: row.digest, updatedAt: now });
      await completeExtractionPublication(reservation);
      committed += 1;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      getDb().run(sql`UPDATE design_system_receipts SET status='failed', updated_at=${now} WHERE id=${row.receiptId}`);
      failed += 1;
    }
  }
  const extractionRows = getSqlite().query<{
    readonly id: string;
    readonly dirPath: string;
    readonly receiptId: string | null;
    readonly receiptStatus: ExtractionRecoverySnapshot["receiptStatus"];
    readonly digest: string | null;
    readonly manifestJson: string | null;
  }, []>(`
    SELECT d.id, d.dir_path AS dirPath, r.id AS receiptId,
           r.status AS receiptStatus, r.digest, r.manifest_json AS manifestJson
      FROM design_systems d
      LEFT JOIN design_system_receipts r ON r.id = (
        SELECT latest.id FROM design_system_receipts latest
         WHERE latest.design_system_id = d.id AND latest.operation = 'content' AND latest.schema_version = 1
         ORDER BY latest.content_revision DESC LIMIT 1
      )
     WHERE d.source_type IN ('github','website','figma','upload')
       AND NOT EXISTS (
         SELECT 1 FROM design_system_receipts owned
          WHERE owned.design_system_id = d.id
            AND (owned.schema_version != 1 OR owned.operation IN ('derive','duplicate')
              OR (owned.operation != 'content' AND owned.status IN ('prepared','recovering')))
       )
     ORDER BY d.id
  `).all();
  const snapshots = await Promise.all(extractionRows.map(async (row): Promise<ExtractionRecoverySnapshot> => {
    try {
      const destination = resolveManagedPath(systemsDir, row.dirPath);
      const destinationExists = await stat(destination).then((item) => item.isDirectory()).catch(() => false);
      const markerExists = destinationExists && await stat(path.join(destination, ".burnguard-publication")).then((item) => item.isFile()).catch(() => false);
      return { id: row.id, hasReceipt: row.receiptId !== null, destinationExists, receiptStatus: row.receiptStatus, markerExists };
    } catch (error) {
      if (error instanceof Error) return { id: row.id, hasReceipt: row.receiptId !== null, destinationExists: true, receiptStatus: row.receiptStatus, markerExists: false };
      throw error;
    }
  }));
  for (const action of classifyExtractionRecovery(snapshots)) {
    if (action.kind === "remove_orphan_row") {
      getDb().run(sql`DELETE FROM design_systems WHERE id=${action.id}`);
      continue;
    }
    const row = extractionRows.find((item) => item.id === action.id);
    if (row?.digest === null || row?.manifestJson === null || row === undefined) throw new ExtractionRecoveryError("committed_digest_missing");
    const destination = resolveManagedPath(systemsDir, row.dirPath);
    const reservation = await recoveryReservation(row.id, destination);
    const published = { ...reservation, stagingDir: destination } satisfies ExtractionReservation;
    const sidecar = await validateExtractionBundle(published);
    if (sidecar.content_digest !== row.digest) throw new ExtractionRecoveryError("digest_mismatch");
    await validateCanonicalTree(destination, parseCanonicalTreeManifest(JSON.parse(row.manifestJson)));
    await completeExtractionPublication(reservation);
  }
  // Failed proof owners retain their exact crash storage across later startups too.
  const held = getSqlite().query<{ readonly id: string }, []>(`
    SELECT DISTINCT r.design_system_id AS id FROM design_system_receipts r
      JOIN design_system_palette_transfers p ON p.receipt_id = r.id
     WHERE r.operation = 'content' AND r.schema_version = 1
       AND r.status IN ('prepared','recovering','failed')
  `).all();
  let cleanup: { readonly removed_staging: number; readonly removed_reservations: number };
  if (held.length === 0) {
    cleanup = await reconcileExtractionPublications(systemsDir);
  } else {
    const entries = await readdir(systemsDir, { withFileTypes: true });
    const staging = entries.filter(entry => entry.isDirectory() && /^\..+\.staging-[0-9a-f-]+$/i.test(entry.name) &&
      !held.some(owner => entry.name.startsWith(`.${owner.id}.staging-`)));
    const reservationRoot = resolveWithin(systemsDir, ".extraction-reservations");
    const reservations = (await readdir(reservationRoot, { withFileTypes: true }).catch(error => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    })).filter(entry => !held.some(owner => entry.name === owner.id));
    await Promise.all([
      ...staging.map(entry => rm(resolveWithin(systemsDir, entry.name), { recursive: true, force: true })),
      ...reservations.map(entry => rm(resolveWithin(reservationRoot, entry.name), { recursive: true, force: true })),
    ]);
    cleanup = { removed_staging: staging.length, removed_reservations: reservations.length };
  }
  return { committed, failed, ...cleanup };
}

async function recoveryReservation(id: string, destinationDir: string): Promise<ExtractionReservation> {
  const entries = await readdir(systemsDir, { withFileTypes: true });
  const prefix = `.${id}.staging-`;
  const staging = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).sort((left, right) => left.name.localeCompare(right.name));
  if (staging.length > 1) throw new ExtractionRecoveryError("multiple_staging_bundles");
  const stagingDir = staging[0] === undefined ? destinationDir : path.join(systemsDir, staging[0].name);
  const publicationToken = await readFile(path.join(stagingDir, ".burnguard-publication"), "utf8").catch(() => "recovered");
  return {
    id,
    root: systemsDir,
    stagingDir,
    destinationDir,
    reservationDir: path.join(systemsDir, ".extraction-reservations", id),
    publicationToken,
  };
}

class ExtractionRecoveryError extends Error {
  readonly name = "ExtractionRecoveryError";
}
