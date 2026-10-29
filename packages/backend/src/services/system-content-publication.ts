import type { Database } from "bun:sqlite";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { getCatalogRow, getCurrentSystemContent, getPendingSystemOperation, type CatalogReceiptRow, type CatalogRow } from "../db/catalog-repository";
import {
  assertSystemContentAuthority, commitSystemContent, getSystemContentReceipt, listSystemContentReceipts,
  prepareSystemContent, removeRolledBackContentCreate, systemContentHead, transitionSystemContent, type NewContentSystem,
} from "../db/design-system-repository";
import { resolveManagedPath } from "../lib/paths";
import { assertSafeName } from "../security/path-boundary";
import { defaultManagedTreeIo, type ManagedTreeIo } from "./artifact-tree-storage";
import { parseCanonicalTreeManifest } from "./canonical-tree-manifest";
import { CatalogFileError, validateCatalogReceiptTree } from "./catalog-files";
import { assertSystemContentLease, withSystemContentAccess, type SystemContentLease } from "./system-content-access";
import {
  contentHash, contentPath, corrupt, digest, exactRecord, operationId, parseContentJournal, parseContentProvenance,
  SystemContentError, type ContentBase, type ContentHead, type ContentJournal, type ContentProvenance, type PaletteHistory,
  type SystemContentWriter, type PairSnapshot,
} from "./system-content-format";
import {
  cloneContentTree, contentPaths, inspectContentTree, pathStat, readPreservedFile, safeContentChild,
  syncContentTree, verifyContentWriteSet, type ContentTree,
} from "./system-content-tree";

export const SYSTEM_CONTENT_BOUNDARIES = [
  "owner-created", "stage-state-written", "stage-css-written", "stage-validated", "stage-synced", "receipt-prepared",
  "base-moved", "base-parent-synced", "candidate-moved", "candidate-parent-synced", "candidate-validated", "before-commit",
  "receipt-committed", "before-backup-remove", "backup-removed", "cleanup-recorded", "rollback-intent-recorded",
  "candidate-discarded", "base-restored", "rollback-recorded",
] as const;
export type ContentBoundary = typeof SYSTEM_CONTENT_BOUNDARIES[number];
export type ContentObservation = {
  readonly systemId: string; readonly row: CatalogRow | null; readonly head: ContentHead | null;
  readonly tree: ContentTree | null; readonly live: string; readonly recordPaths: readonly (string | null)[];
};
export type ContentValidator = (root: string, journal: ContentJournal) => Promise<void>;
export type ContentAdapter = {
  readonly provenance: ContentProvenance;
  readonly writeSet: (base: ContentObservation) => readonly string[];
  readonly transform: (stage: string, base: ContentObservation, boundary: (name: ContentBoundary) => Promise<void>) => Promise<void>;
  readonly validate: ContentValidator;
  readonly paletteHistory?: (base: ContentObservation, stage: string) => Promise<PaletteHistory>;
  /** Palette supplies its fixed-order actual-pair digest here; other writers use contentObservationDigest. */
  readonly expectedIdentity?: (base: ContentObservation) => Promise<string>;
};
export type ContentEnvironment = {
  readonly db: Database; readonly systemsRoot: string; readonly operationId: () => string; readonly now: () => number;
  readonly io?: ManagedTreeIo; readonly atBoundary?: (name: ContentBoundary) => Promise<void>;
  /** Trusted application validators, not functions read from the journal. Missing writers hold recovery. */
  readonly validators: Readonly<Partial<Record<SystemContentWriter, ContentValidator>>>;
};
export type ContentResult = { readonly receipt: CatalogReceiptRow | null; readonly observation: ContentObservation; readonly noOp: boolean };
type Paths = Awaited<ReturnType<typeof contentPaths>>;

export function contentObservationDigest(base: ContentObservation): string {
  return contentHash(JSON.stringify(["system-content-observation-v1", base.systemId, base.row?.metadataRevision ?? null,
    base.row?.lifecycle ?? null, base.recordPaths, base.head, base.tree?.manifest.tree_digest ?? null, base.tree?.preservation_digest ?? null]));
}
function boundary(env: ContentEnvironment, name: ContentBoundary): Promise<void> { return env.atBoundary?.(name) ?? Promise.resolve(); }
function ioFor(env: ContentEnvironment): ManagedTreeIo { return env.io ?? defaultManagedTreeIo; }
function conflict(): never { throw new SystemContentError("system_content_conflict"); }
function baseOf(observation: ContentObservation): ContentBase | null {
  if (observation.row === null || observation.tree === null) return null;
  if (observation.row.lifecycle === "trashed") return conflict();
  return { head: observation.head, metadata_revision: observation.row.metadataRevision, lifecycle: observation.row.lifecycle, manifest: observation.tree.manifest, preservation_digest: observation.tree.preservation_digest };
}
export async function observeSystemContent(env: ContentEnvironment, id: string, lease: SystemContentLease): Promise<ContentObservation> {
  assertSystemContentLease(lease, env.systemsRoot, id);
  if (getPendingSystemOperation(env.db, id) !== null) throw new SystemContentError("system_content_unavailable");
  const live = await safeContentChild(env.systemsRoot, assertSafeName(id));
  const row = getCatalogRow(env.db, id);
  const head = systemContentHead(env.db, id);
  if (row === null) {
    if (await pathStat(live) !== null || head !== null) conflict();
    return { systemId: id, row, head, tree: null, live, recordPaths: [] };
  }
  if (row.lifecycle === "trashed" || resolveManagedPath(env.systemsRoot, row.dirPath) !== live) conflict();
  const recordPaths: (string | null)[] = [id];
  for (const stored of [row.skillMdPath, row.tokensCssPath, row.readmeMdPath]) {
    if (stored === null) { recordPaths.push(null); continue; }
    const resolved = resolveManagedPath(live, stored);
    const relative = path.relative(live, resolved).split(path.sep).join("/");
    contentPath(relative);
    await safeContentChild(live, ...relative.split("/"));
    recordPaths.push(relative);
  }
  const tree = await inspectContentTree(live);
  const receipt = getCurrentSystemContent(env.db, id);
  if (receipt !== null) {
    try { await validateCatalogReceiptTree(live, receipt); }
    catch (error) {
      if (error instanceof CatalogFileError) throw new SystemContentError(error.code === "catalog_manifest_unverifiable" ? "system_content_corrupt" : "system_content_conflict");
      throw error;
    }
  }
  return { systemId: id, row, head, tree, live, recordPaths };
}
async function writeOwner(env: ContentEnvironment, paths: Paths, id: string, op: string): Promise<void> {
  await mkdir(paths.controls, { recursive: true });
  await safeContentChild(env.systemsRoot, ".system-content");
  await mkdir(paths.control);
  const handle = await open(paths.owner, "wx");
  try { await handle.writeFile(JSON.stringify({ version: 1, operation_id: op, system_id: id })); await ioFor(env).syncFile(handle); }
  finally { await handle.close(); }
  await ioFor(env).syncDirectory(paths.control);
  await ioFor(env).syncDirectory(paths.controls);
}
async function verifyOwner(paths: Paths, journal: Pick<ContentJournal, "operation_id" | "system_id">): Promise<void> {
  const info = await pathStat(paths.control);
  if (info === null) conflict();
  const marker = exactRecord(JSON.parse((await readPreservedFile(paths.control, "owner.json", undefined, 1024)).toString("utf8")), ["version", "operation_id", "system_id"]);
  if (marker["version"] !== 1 || marker["operation_id"] !== journal.operation_id || marker["system_id"] !== journal.system_id) conflict();
  for (const name of await readdir(paths.control)) {
    if (!["owner.json", "stage", "previous", "discard"].includes(name)) conflict();
    await safeContentChild(paths.control, name);
  }
}
function parseReceipt(receipt: CatalogReceiptRow): { readonly journal: ContentJournal; readonly provenance: ContentProvenance } {
  if (receipt.schemaVersion !== 2 || receipt.operation !== "content" || receipt.contentRevision < 1) return corrupt();
  const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
  const provenance = parseContentProvenance(JSON.parse(receipt.provenanceJson));
  const manifest = parseCanonicalTreeManifest(JSON.parse(receipt.manifestJson));
  if (receipt.id !== `system-content-${journal.operation_id}` || receipt.designSystemId !== journal.system_id || receipt.digest !== manifest.tree_digest ||
    receipt.parentReceiptId !== (journal.base?.head?.receipt_id ?? null) || receipt.parentDigest !== (journal.base?.head?.digest ?? null) ||
    receipt.parentSystemId !== (journal.base?.head == null ? null : journal.system_id) ||
    (provenance.writer === "palette") !== (journal.palette_history !== null)) return corrupt();
  return { journal, provenance };
}
async function verifiedPaths(env: ContentEnvironment, receipt: CatalogReceiptRow): Promise<Paths> {
  const { journal } = parseReceipt(receipt);
  const paths = await contentPaths(env.systemsRoot, journal.system_id, journal.operation_id);
  if (receipt.destinationPath !== paths.live || receipt.sourcePath !== (journal.mode === "replace" ? paths.live : null)) conflict();
  const row = getCatalogRow(env.db, journal.system_id);
  if (row === null || resolveManagedPath(env.systemsRoot, row.dirPath) !== paths.live) conflict();
  await verifyOwner(paths, journal);
  return paths;
}
async function matchTree(target: string, manifestDigest: string, preservationDigest: string): Promise<ContentTree> {
  const tree = await inspectContentTree(target);
  if (tree.manifest.tree_digest !== manifestDigest || tree.preservation_digest !== preservationDigest) conflict();
  return tree;
}
async function matchPair(root: string, pair: PairSnapshot): Promise<void> {
  if (!pair.present) {
    for (const name of ["state.json", "scales.css"]) if (await pathStat(await safeContentChild(root, "palette", name)) !== null) conflict();
    return;
  }
  for (const [name, file] of [["state.json", pair.json], ["scales.css", pair.css]] as const) {
    const bytes = await readPreservedFile(root, `palette/${name}`);
    if (bytes.length !== file.length || contentHash(bytes) !== file.sha256 || bytes.toString("utf8") !== file.bytes) conflict();
  }
}
async function candidate(env: ContentEnvironment, target: string, receipt: CatalogReceiptRow): Promise<void> {
  const { journal, provenance } = parseReceipt(receipt);
  const validate = env.validators[provenance.writer];
  if (validate === undefined) throw new SystemContentError("system_content_unavailable");
  await matchTree(target, receipt.digest, journal.result_preservation_digest);
  if (journal.palette_history !== null) await matchPair(target, journal.palette_history.after);
  await validate(target, journal);
}
async function oldTree(target: string, journal: ContentJournal): Promise<void> {
  if (journal.base === null) conflict();
  await matchTree(target, journal.base.manifest.tree_digest, journal.base.preservation_digest);
  if (journal.palette_history !== null) await matchPair(target, journal.palette_history.before);
}
async function move(env: ContentEnvironment, from: string, to: string, moved: ContentBoundary, synced?: ContentBoundary): Promise<void> {
  if (await pathStat(to) !== null) conflict();
  await ioFor(env).rename(from, to);
  await boundary(env, moved);
  await ioFor(env).syncDirectory(path.dirname(from));
  if (path.dirname(from) !== path.dirname(to)) await ioFor(env).syncDirectory(path.dirname(to));
  if (synced !== undefined) await boundary(env, synced);
}
function fresh(env: ContentEnvironment, receipt: CatalogReceiptRow): CatalogReceiptRow {
  const result = getSystemContentReceipt(env.db, receipt.id);
  if (result === null) return corrupt();
  return result;
}
async function chooseRollback(env: ContentEnvironment, receipt: CatalogReceiptRow): Promise<CatalogReceiptRow> {
  const current = fresh(env, receipt);
  if (current.status === "committed") return current;
  const { journal } = parseReceipt(current);
  const changed = transitionSystemContent(env.db, current, { ...journal, intent: "rollback", failure_code: "system_content_failed" }, current.status, env.now());
  await boundary(env, "rollback-intent-recorded");
  return changed;
}
async function resumePublish(env: ContentEnvironment, receipt: CatalogReceiptRow): Promise<CatalogReceiptRow> {
  const { journal } = parseReceipt(receipt);
  const paths = await verifiedPaths(env, receipt);
  if (journal.intent !== "publish" || journal.failure_code !== null) conflict();
  assertSystemContentAuthority(env.db, journal.system_id, journal.base, journal.mode === "create");
  if (getPendingSystemOperation(env.db, journal.system_id)?.id !== receipt.id) conflict();
  if (await pathStat(paths.discard) !== null) conflict();
  let live = await pathStat(paths.live) !== null;
  let previous = await pathStat(paths.previous) !== null;
  const stage = await pathStat(paths.stage) !== null;
  const validateStage = async (): Promise<void> => {
    try { await candidate(env, paths.stage, receipt); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      const rolled = await chooseRollback(env, receipt);
      await rollback(env, rolled);
      throw new SystemContentError("system_content_failed");
    }
  };
  if (journal.mode === "replace" && !previous) {
    if (!live) conflict();
    await oldTree(paths.live, journal);
    await validateStage();
    await move(env, paths.live, paths.previous, "base-moved", "base-parent-synced");
    live = false;
    previous = true;
  }
  if (journal.mode === "create" && previous) conflict();
  if (previous) await oldTree(paths.previous, journal);
  if (!live) {
    if (!stage) {
      const rolled = await chooseRollback(env, receipt);
      await rollback(env, rolled);
      throw new SystemContentError("system_content_failed");
    }
    await validateStage();
    // Recheck authority after any awaitable fault boundary and immediately before publication.
    assertSystemContentAuthority(env.db, journal.system_id, journal.base, journal.mode === "create");
    if (previous) await oldTree(paths.previous, journal);
    await move(env, paths.stage, paths.live, "candidate-moved", "candidate-parent-synced");
  } else if (stage) conflict();
  await candidate(env, paths.live, receipt);
  if (previous) await oldTree(paths.previous, journal);
  await boundary(env, "candidate-validated");
  await boundary(env, "before-commit");
  await candidate(env, paths.live, receipt);
  if (previous) await oldTree(paths.previous, journal);
  commitSystemContent(env.db, receipt, env.now());
  await boundary(env, "receipt-committed");
  return fresh(env, receipt);
}
async function rollback(env: ContentEnvironment, receipt: CatalogReceiptRow): Promise<CatalogReceiptRow | null> {
  const { journal } = parseReceipt(receipt);
  if (journal.intent !== "rollback" || receipt.status === "committed") conflict();
  if ((receipt.status === "failed" || journal.mode === "create") && journal.cleanup === "complete") {
    const paths = await contentPaths(env.systemsRoot, journal.system_id, journal.operation_id);
    if (await pathStat(paths.control) === null) {
      if (journal.mode === "create") {
        if (await pathStat(paths.live) !== null) conflict();
        removeRolledBackContentCreate(env.db, receipt);
        return null;
      }
      await oldTree(paths.live, journal);
      return receipt;
    }
  }
  const paths = await verifiedPaths(env, receipt);
  assertSystemContentAuthority(env.db, journal.system_id, journal.base, journal.mode === "create");
  const previous = await pathStat(paths.previous) !== null;
  const live = await pathStat(paths.live) !== null;
  if (previous) {
    await oldTree(paths.previous, journal);
    if (live) {
      await candidate(env, paths.live, receipt);
      await move(env, paths.live, paths.discard, "candidate-discarded");
    }
    await oldTree(paths.previous, journal);
    await move(env, paths.previous, paths.live, "base-restored");
  } else if (journal.mode === "replace") {
    if (!live) conflict();
    await oldTree(paths.live, journal);
  } else if (live) {
    await candidate(env, paths.live, receipt);
    await move(env, paths.live, paths.discard, "candidate-discarded");
  }
  if (journal.mode === "replace") await oldTree(paths.live, journal);
  else if (await pathStat(paths.live) !== null) conflict();
  // Divergent candidate remnants are not deletion authority, even after the base was restored.
  for (const target of [paths.stage, paths.discard]) if (await pathStat(target) !== null) await candidate(env, target, receipt);
  if (journal.mode === "create") {
    // Keep creation nonterminal until cleaned storage and its reserved database row are both gone.
    await cleanup(env, receipt);
    removeRolledBackContentCreate(env.db, fresh(env, receipt));
    await boundary(env, "rollback-recorded");
    return null;
  }
  let failed = receipt;
  if (receipt.status !== "failed") {
    failed = transitionSystemContent(env.db, receipt, journal, "failed", env.now());
    await boundary(env, "rollback-recorded");
  }
  await cleanup(env, failed);
  const cleaned = fresh(env, failed);
  return cleaned;
}
async function cleanup(env: ContentEnvironment, receipt: CatalogReceiptRow): Promise<void> {
  const { journal } = parseReceipt(receipt);
  const paths = await contentPaths(env.systemsRoot, journal.system_id, journal.operation_id);
  if (await pathStat(paths.control) === null) {
    if (journal.cleanup !== "complete") conflict();
    return;
  }
  await verifiedPaths(env, receipt);
  if (receipt.status === "committed") {
    const head = getCurrentSystemContent(env.db, journal.system_id);
    if (head === null) conflict();
    await validateCatalogReceiptTree(paths.live, head);
    if (head.id === receipt.id) await candidate(env, paths.live, receipt);
  } else if (journal.intent === "rollback" && (receipt.status === "failed" || journal.mode === "create")) {
    if (journal.mode === "replace") await oldTree(paths.live, journal);
    else if (await pathStat(paths.live) !== null) conflict();
  } else conflict();
  for (const name of ["previous", "stage", "discard"] as const) {
    const target = paths[name];
    if (await pathStat(target) === null) continue;
    await verifyOwner(paths, journal);
    if (name === "previous") await oldTree(target, journal);
    else await candidate(env, target, receipt);
    if (name === "previous") await boundary(env, "before-backup-remove");
    // Boundaries may permit an external writer, so evidence is checked again before deletion.
    if (receipt.status === "committed") {
      const head = getCurrentSystemContent(env.db, journal.system_id);
      if (head === null) conflict();
      await validateCatalogReceiptTree(paths.live, head);
      if (head.schemaVersion === 2) await candidate(env, paths.live, head);
    } else if (journal.mode === "replace") await oldTree(paths.live, journal);
    else if (await pathStat(paths.live) !== null) conflict();
    if (name === "previous") await oldTree(target, journal);
    else await candidate(env, target, receipt);
    await rm(target, { recursive: true });
    await ioFor(env).syncDirectory(paths.control);
    if (name === "previous") await boundary(env, "backup-removed");
  }
  if (journal.cleanup !== "complete") transitionSystemContent(env.db, receipt, { ...journal, cleanup: "complete" }, receipt.status, env.now());
  await boundary(env, "cleanup-recorded");
  await verifyOwner(paths, journal);
  if ((await readdir(paths.control)).some((name) => name !== "owner.json")) conflict();
  await rm(paths.control, { recursive: true });
  await ioFor(env).syncDirectory(paths.controls);
}

export async function publishSystemContent(env: ContentEnvironment, input: {
  readonly systemId: string; readonly mode: "replace" | "create"; readonly expectedDigest: string;
  readonly adapter: ContentAdapter; readonly create?: NewContentSystem; readonly lease?: SystemContentLease;
}): Promise<ContentResult> {
  const run = async (lease: SystemContentLease): Promise<ContentResult> => {
    assertSystemContentLease(lease, env.systemsRoot, input.systemId);
    const observation = await observeSystemContent(env, input.systemId, lease);
    if ((input.mode === "create") !== (observation.row === null) || (input.mode === "create") !== (input.create !== undefined)) conflict();
    const expected = await (input.adapter.expectedIdentity?.(observation) ?? contentObservationDigest(observation));
    if (digest(input.expectedDigest) !== digest(expected)) throw new SystemContentError("expected_digest_conflict");
    const op = operationId(env.operationId());
    const paths = await contentPaths(env.systemsRoot, input.systemId, op);
    if (await pathStat(paths.control) !== null) conflict();
    const provenance = parseContentProvenance(input.adapter.provenance);
    const prior = getCurrentSystemContent(env.db, input.systemId);
    const sourceExtraction = prior === null ? null : prior.schemaVersion === 2
      ? parseContentProvenance(JSON.parse(prior.provenanceJson)).source_extraction
      : { receipt_id: prior.operation === "content" ? prior.id : prior.parentReceiptId, digest: prior.digest };
    if (JSON.stringify(provenance.source_extraction) !== JSON.stringify(sourceExtraction)) conflict();
    if (env.validators[provenance.writer] !== input.adapter.validate) throw new SystemContentError("system_content_unavailable");
    let prepared: CatalogReceiptRow | null = null;
    let ownerWritten = false;
    try {
      await writeOwner(env, paths, input.systemId, op);
      ownerWritten = true;
      await boundary(env, "owner-created");
      if (observation.tree === null) await mkdir(paths.stage);
      else await cloneContentTree(paths.live, paths.stage, observation.tree);
      await input.adapter.transform(paths.stage, observation, (name) => boundary(env, name));
      const result = await inspectContentTree(paths.stage);
      const writeSet = [...input.adapter.writeSet(observation)].map(contentPath);
      const history = input.adapter.paletteHistory === undefined ? null : await input.adapter.paletteHistory(observation, paths.stage);
      const journal = parseContentJournal({
        transaction_version: 1, operation_id: op, system_id: input.systemId, mode: input.mode, intent: "publish", cleanup: "pending",
        base: baseOf(observation), result_preservation_digest: result.preservation_digest, write_set: writeSet, palette_history: history, failure_code: null,
      });
      if (journal.palette_history !== null) {
        if (observation.tree !== null) await matchPair(paths.live, journal.palette_history.before);
        await matchPair(paths.stage, journal.palette_history.after);
      }
      await input.adapter.validate(paths.stage, journal);
      await boundary(env, "stage-validated");
      const identical = observation.tree?.preservation_digest === result.preservation_digest;
      if (!identical) verifyContentWriteSet(observation.tree, result, writeSet);
      await syncContentTree(paths.stage, result, ioFor(env));
      await boundary(env, "stage-synced");
      const current = await observeSystemContent(env, input.systemId, lease);
      if (contentObservationDigest(current) !== contentObservationDigest(observation)) conflict();
      if (identical) {
        await removeOwnedOrphan(env, paths, op, input.systemId);
        return { receipt: getCurrentSystemContent(env.db, input.systemId), observation: current, noOp: true };
      }
      await matchTree(paths.stage, result.manifest.tree_digest, result.preservation_digest);
      await input.adapter.validate(paths.stage, journal);
      if (input.create !== undefined) {
        for (const stored of [input.create.skillMdPath, input.create.tokensCssPath, input.create.readmeMdPath]) {
          if (stored === null) continue;
          const resolved = resolveManagedPath(env.systemsRoot, stored);
          const relative = contentPath(path.relative(paths.live, resolved).split(path.sep).join("/"));
          if (!result.inventory.some((entry) => entry[0] === "file" && entry[1] === relative)) conflict();
        }
      }
      prepared = prepareSystemContent(env.db, { id: `system-content-${op}`, journal, manifest: result.manifest, provenance, live: paths.live, now: env.now(), create: input.create ?? null });
      await boundary(env, "receipt-prepared");
      prepared = await resumePublish(env, prepared);
    } catch (error) {
      // SQLite may have committed even if its caller observed an exception. Read the exact receipt first.
      const persisted = getSystemContentReceipt(env.db, `system-content-${op}`);
      if (persisted?.status === "committed") prepared = persisted;
      else if (persisted !== null) {
        const rolled = await chooseRollback(env, persisted);
        await rollback(env, rolled);
        throw error;
      } else {
        if (ownerWritten) await removeOwnedOrphan(env, paths, op, input.systemId);
        throw error;
      }
    }
    if (prepared === null || prepared.status !== "committed") conflict();
    // Cleanup is retryable; failed cleanup cannot turn a committed operation into rollback.
    try { await cleanup(env, prepared); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      prepared = fresh(env, prepared);
    }
    await candidate(env, paths.live, prepared);
    const committed = await observeSystemContent(env, input.systemId, lease);
    return { receipt: fresh(env, prepared), observation: committed, noOp: false };
  };
  try {
    return await (input.lease === undefined ? withSystemContentAccess(env.db, env.systemsRoot, [input.systemId], run) : run(input.lease));
  } catch (error) {
    if (error instanceof SystemContentError) throw error;
    throw new SystemContentError("system_content_failed");
  }
}
async function removeOwnedOrphan(env: ContentEnvironment, paths: Paths, op: string, id: string): Promise<void> {
  if (getSystemContentReceipt(env.db, `system-content-${op}`) !== null) conflict();
  await verifyOwner(paths, { operation_id: op, system_id: id });
  if (await pathStat(paths.previous) !== null || await pathStat(paths.discard) !== null) conflict();
  // A partial stage is not authority. Inspect it for links/limits before owned orphan removal.
  if (await pathStat(paths.stage) !== null) await inspectContentTree(paths.stage);
  await rm(paths.control, { recursive: true });
  await ioFor(env).syncDirectory(paths.controls);
}

export async function recoverSystemContent(env: ContentEnvironment): Promise<{ readonly recovered: number; readonly held: readonly string[] }> {
  let recovered = 0;
  const held: string[] = [];
  for (const initial of listSystemContentReceipts(env.db)) {
    try {
      const parsed = parseReceipt(initial);
      const paths = await contentPaths(env.systemsRoot, parsed.journal.system_id, parsed.journal.operation_id);
      if (parsed.journal.cleanup === "complete" && await pathStat(paths.control) === null && !(parsed.journal.mode === "create" && parsed.journal.intent === "rollback")) {
        if (initial.status === "committed" && getPendingSystemOperation(env.db, initial.designSystemId) === null) {
          await withSystemContentAccess(env.db, env.systemsRoot, [initial.designSystemId], async () => {
            const head = getCurrentSystemContent(env.db, initial.designSystemId);
            if (head?.id === initial.id && getCatalogRow(env.db, initial.designSystemId)?.lifecycle !== "trashed") {
              await validateCatalogReceiptTree(paths.live, head);
            }
          }, initial.id);
        }
        continue;
      }
      await withSystemContentAccess(env.db, env.systemsRoot, [initial.designSystemId], async () => {
        let receipt = fresh(env, initial);
        const { journal } = parseReceipt(receipt);
        if (journal.failure_code !== null && journal.failure_code !== "system_content_failed") conflict();
        if (receipt.status === "committed") await cleanup(env, receipt);
        else if (receipt.status === "failed" || journal.intent === "rollback") await rollback(env, receipt);
        else {
          if (receipt.status === "prepared") receipt = transitionSystemContent(env.db, receipt, journal, "recovering", env.now());
          receipt = await resumePublish(env, receipt);
          await cleanup(env, receipt);
        }
        recovered += 1;
      }, initial.id);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const current = getSystemContentReceipt(env.db, initial.id);
      let completedRollback = false;
      if (current?.status === "failed") {
        try {
          const journal = parseReceipt(current).journal;
          completedRollback = journal.mode === "replace" && journal.cleanup === "complete";
        }
        catch (parseError) { if (!(parseError instanceof Error)) throw parseError; }
      }
      if (current === null || completedRollback) {
        recovered += 1;
        continue;
      }
      if (current !== null && (current.status === "prepared" || current.status === "recovering") &&
        error instanceof SystemContentError && (error.code === "system_content_conflict" || error.code === "system_content_corrupt")) {
        // Invalid persisted JSON is preserved verbatim. Only a fully parsed journal can record a hold.
        try {
          const { journal } = parseReceipt(current);
          transitionSystemContent(env.db, current, { ...journal, failure_code: "system_content_conflict" }, current.status, env.now());
        } catch (parseError) {
          if (!(parseError instanceof Error)) throw parseError;
        }
      }
      held.push(initial.id);
    }
  }
  const controls = await safeContentChild(env.systemsRoot, ".system-content");
  if (await pathStat(controls) !== null) {
    for (const name of await readdir(controls)) {
      try {
        const op = operationId(name);
        if (getSystemContentReceipt(env.db, `system-content-${op}`) !== null) continue;
        const control = await safeContentChild(controls, op);
        const owner = exactRecord(JSON.parse((await readPreservedFile(control, "owner.json", undefined, 1024)).toString("utf8")), ["version", "operation_id", "system_id"]);
        if (owner["version"] !== 1 || owner["operation_id"] !== op || typeof owner["system_id"] !== "string") conflict();
        const id = assertSafeName(owner["system_id"]);
        await withSystemContentAccess(env.db, env.systemsRoot, [id], async () => removeOwnedOrphan(env, await contentPaths(env.systemsRoot, id, op), op, id));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        held.push(name);
      }
    }
  }
  return { recovered, held };
}
