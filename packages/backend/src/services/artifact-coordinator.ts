import type { Database } from "bun:sqlite";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import { applyHtmlNodePatch, fingerprintHtmlNode, type PatchHtmlNodeInput } from "./file-patch";
import { inspectCanonicalTree, validateCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { ArtifactPublicationPolicyError, diffManagedTrees, manifestEntry, materializeManagedTree, publishManagedTree, syncManagedTree, defaultManagedTreeIo, type ManagedTreeIo, type ArtifactFileDiff, type PublicationPolicy } from "./artifact-tree-storage";
import { publishArtifactOperationEvent } from "./artifact-operation-events";
import { beginArtifactPublication, endArtifactPublication } from "./artifact-publication-registry";
import { replaceArtifactFileIndex, replaceArtifactFileIndexInTransaction } from "../db/artifact-file-index";
import { adoptExistingArtifact, establishEmptyArtifactAuthority } from "./artifact-initialization";
import { parsePersistedArtifactOperation, type PersistedArtifactOperationRow } from "./artifact-operation-record";
import { pruneExpiredArtifactOperations, RETENTION_MS } from "./artifact-retention";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { acquireArtifactProjectLock } from "./artifact-project-lock";
import { waitForProjectReady } from "./watcher-registry";
import { isArtifactMutationBlockedByAlternatives } from "./visual-alternative-operation-registry";
import {
  allowedFigmaReferencePaths,
  assertFigmaManifestChangesAllowed,
  assertFigmaReferencePathsAllowed,
  assertFigmaReferencesPreserved,
  loadFigmaReferencePolicy,
  type FigmaReferencePolicy,
} from "./figma-reference-policy";
import { isArtifactRecoveryHeld } from "./artifact-recovery-hold";
import { FigmaImportError } from "./figma-import-errors";
import {
  AcquisitionLimitError,
  ExtractionAcquisitionError,
  throwIfAcquisitionAborted,
} from "./extraction-acquisition";

type OperationKind = "patch" | "palette" | "turn" | "restore" | "undo" | "external" | "initialize" | "figma_import" | "reapply_external";
type CoordinatorFaults = {
  readonly beforeSnapshot?: () => void;
  readonly beforePublishRead?: (relativePath: string) => void | Promise<void>;
  readonly beforePublishSourceRead?: (relativePath: string) => void | Promise<void>;
  readonly afterPublishWrite?: (relativePath: string) => void;
  readonly beforeDatabaseCommit?: () => void;
  /** Durability seam; tests observe the flush order. */
  readonly treeIo?: ManagedTreeIo;
  readonly beforeFileIndex?: () => void;
  readonly beforeBaselineFinalize?: () => void;
  readonly beforeRollback?: () => void;
  readonly afterExternalCapture?: () => void;
};
type RunOperation = {
  readonly projectId: string;
  readonly projectDir: string;
  readonly kind: OperationKind;
  readonly expectedRevision: number;
  readonly expectedArtifactDigest: string;
  readonly mutate: (stagePath: string) => Promise<void>;
  readonly operationId?: string;
  readonly onPrepared?: (stagePath: string) => void;
  readonly parentOperationId?: string;
  readonly expectedFileHash?: string;
  readonly nodeFingerprint?: string;
  readonly publicationPolicy?: PublicationPolicy;
  readonly signal?: AbortSignal;
};
type PatchOperation = {
  readonly projectId: string;
  readonly projectDir: string;
  readonly relPath: string;
  readonly expectedRevision: number;
  readonly expectedArtifactDigest: string;
  readonly expectedFileHash: string;
  readonly nodeBgId: string;
  readonly nodeFingerprint: string;
  readonly patch: PatchHtmlNodeInput;
};
type UndoOperation = {
  readonly projectId: string;
  readonly projectDir: string;
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly expectedArtifactDigest: string;
};
export type CommittedArtifactOperation = {
  readonly id: string;
  readonly kind: OperationKind;
  readonly status: "committed" | "cancelled" | "conflicted";
  readonly baseRevision: number;
  readonly baseDigest: string;
  readonly resultRevision: number;
  readonly resultDigest: string;
  readonly diff: readonly ArtifactFileDiff[];
};
type ProjectIdentity = { readonly revision: number; readonly digest: string | null };

export class ArtifactOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Mutations validate against the stable identity, so they wait until startup has adopted external edits. */
async function waitForStartupObservation(projectId: string): Promise<void> {
  try { await waitForProjectReady(projectId); }
  catch (error) {
    if (error instanceof ArtifactOperationError) throw error;
    throw new ArtifactOperationError("recovery_unavailable", "Project files could not be verified at startup; no files were changed");
  }
}

export class ArtifactCoordinator {
  constructor(private readonly db: Database, private readonly faults: CoordinatorFaults = {}) {}

  private get treeIo(): ManagedTreeIo { return this.faults.treeIo ?? defaultManagedTreeIo; }

  private assertNotHeld(projectId: string): void {
    if (isArtifactRecoveryHeld(this.db, projectId)) throw new ArtifactOperationError("recovery_unavailable", "Project recovery is held until the next restart");
  }

  async initialize(projectId: string, projectDir: string): Promise<CanonicalTreeManifest> {
    this.assertNotHeld(projectId);
    const release = await acquireArtifactProjectLock(this.db, projectId);
    try { return await this.initializeOnce(projectId, projectDir); }
    finally { release(); }
  }

  private async initializeOnce(projectId: string, projectDir: string): Promise<CanonicalTreeManifest> {
    const actual = await inspectCanonicalTree(projectDir);
    const identity = this.projectIdentity(projectId);
    let baselineSource = projectDir;
    if (identity.digest === null) baselineSource = await adoptExistingArtifact(this.db, projectId, projectDir, identity.revision, actual);
    else if (identity.digest !== actual.tree_digest) throw new ArtifactOperationError("artifact_identity_mismatch", "Live artifact bytes differ from the stable identity");
    await materializeManagedTree(baselineSource, this.baselinePath(projectDir), this.treeIo);
    replaceArtifactFileIndex(this.db, projectId, actual);
    return actual;
  }

  async initializeProject(projectId: string, projectDir: string, mutate: (stagePath: string) => Promise<void>): Promise<CommittedArtifactOperation> {
    const identity = this.projectIdentity(projectId);
    if (identity.revision !== 0 || identity.digest !== null) throw new ArtifactOperationError("operation_conflict", "Project is already initialized");
    const empty = await inspectCanonicalTree(projectDir);
    if (empty.files.length !== 0) throw new ArtifactOperationError("artifact_identity_mismatch", "New project storage is not empty");
    establishEmptyArtifactAuthority(this.db, projectId, empty);
    await materializeManagedTree(projectDir, this.baselinePath(projectDir), this.treeIo);
    return this.run({ projectId, projectDir, kind: "initialize", expectedRevision: 0, expectedArtifactDigest: empty.tree_digest, mutate });
  }

  async patch(input: PatchOperation): Promise<CommittedArtifactOperation> {
    await waitForStartupObservation(input.projectId);
    const actual = await this.validateBase(input.projectId, input.projectDir, input.expectedRevision, input.expectedArtifactDigest);
    const file = manifestEntry(actual, input.relPath);
    if (file?.sha256 !== input.expectedFileHash) throw new ArtifactOperationError("stale_file_hash", "Expected file hash is stale");
    const source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path.join(input.projectDir, input.relPath)));
    const fingerprint = fingerprintHtmlNode(source, input.nodeBgId);
    if (fingerprint.fingerprint !== input.nodeFingerprint) throw new ArtifactOperationError("stale_node_fingerprint", "Expected node fingerprint is stale");
    const patchedSource = applyHtmlNodePatch(source, { ...input.patch, node_bg_id: input.nodeBgId });
    return this.run({
      projectId: input.projectId, projectDir: input.projectDir, kind: "patch",
      expectedRevision: input.expectedRevision, expectedArtifactDigest: input.expectedArtifactDigest,
      expectedFileHash: input.expectedFileHash, nodeFingerprint: input.nodeFingerprint,
      mutate: async (stage) => { await writeFile(path.join(stage, input.relPath), patchedSource); },
    });
  }

  async run(input: RunOperation): Promise<CommittedArtifactOperation> {
    this.assertNotHeld(input.projectId);
    await waitForStartupObservation(input.projectId);
    const id = input.operationId ?? ulid();
    const ownedRoot = this.operationPath(input.projectDir, id);
    const snapshotPath = path.join(ownedRoot, "snapshot");
    const stagePath = path.join(ownedRoot, "stage");
    let base: CanonicalTreeManifest;
    let figmaReferences: FigmaReferencePolicy = { files: [], promptEntries: [] };
    // Admission (base validation through registration) is serialized with external observation and
    // adoption, so an operation is either registered before they look or validates against their result.
    const releaseAdmission = await acquireArtifactProjectLock(this.db, input.projectId);
    try {
      if (isArtifactMutationBlockedByAlternatives(this.db, input.projectId, id)) {
        throw new ArtifactOperationError("operation_conflict", "Visual alternatives are being generated for this project");
      }
      await pruneExpiredArtifactOperations(this.db, { projectId: input.projectId, preserveOperationId: input.parentOperationId });
      throwIfAcquisitionAborted(input.signal);
      base = await this.validateBase(input.projectId, input.projectDir, input.expectedRevision, input.expectedArtifactDigest);
      figmaReferences = await loadFigmaReferencePolicy(input.projectDir, base, input.signal);
      this.faults.beforeSnapshot?.();
      try {
        await materializeManagedTree(input.projectDir, snapshotPath, this.treeIo);
        await validateCanonicalTree(snapshotPath, base);
        await materializeManagedTree(input.projectDir, stagePath);
        await validateCanonicalTree(stagePath, base);
        this.insertWorking(id, input, base, snapshotPath, stagePath);
      } catch (error) {
        await rm(ownedRoot, { recursive: true, force: true });
        throw error;
      }
    } finally { releaseAdmission(); }
    input.onPrepared?.(stagePath);
    let publicationStarted = false;
    let releasePublication: (() => void) | null = null;
    let result: CanonicalTreeManifest;
    let diff: readonly ArtifactFileDiff[];
    const resultRevision = input.expectedRevision + 1;
    try {
      throwIfAcquisitionAborted(input.signal);
      await input.mutate(stagePath);
      throwIfAcquisitionAborted(input.signal);
      await assertFigmaReferencesPreserved(stagePath, figmaReferences, input.signal, { checkCopiedBytes: false });
      result = await inspectCanonicalTree(stagePath);
      const stagedFigmaReferences = await loadFigmaReferencePolicy(
        stagePath,
        result,
        input.signal,
      );
      assertFigmaReferencePathsAllowed(result, stagedFigmaReferences);
      assertFigmaManifestChangesAllowed(
        figmaReferences,
        stagedFigmaReferences,
        // Imports add references; initialization (e.g. restoring a project bundle) may carry validated ones.
        input.kind === "figma_import" || input.kind === "initialize",
      );
      diff = diffManagedTrees(base, result);
      if (diff.length === 0) {
        this.terminal(id, "cancelled", input.expectedRevision, base.tree_digest);
        publishArtifactOperationEvent(this.db, { projectId: input.projectId, operationId: id, revision: input.expectedRevision, digest: base.tree_digest, outcome: "cancelled", diff });
        return { id, kind: input.kind, status: "cancelled", baseRevision: input.expectedRevision, baseDigest: base.tree_digest, resultRevision: input.expectedRevision, resultDigest: base.tree_digest, diff };
      }
      releasePublication = await acquireArtifactProjectLock(this.db, input.projectId);
      this.prepareResult(id, resultRevision, result, diff);
      beginArtifactPublication(input.projectId);
      publicationStarted = true;
      // The staged policy is already validated; it registers reference paths added by this operation.
      const immutableReferencePaths = mergeImmutableReferencePaths(
        mergeImmutableReferencePaths(
          allowedFigmaReferencePaths(figmaReferences),
          allowedFigmaReferencePaths(stagedFigmaReferences),
        ),
        input.publicationPolicy?.immutableReferencePaths,
      );
      await publishManagedTree(stagePath, input.projectDir, (relativePath) => {
        throwIfAcquisitionAborted(input.signal);
        this.faults.afterPublishWrite?.(relativePath);
      }, {
        ...input.publicationPolicy,
        immutableReferencePaths,
        beforeSourceOpen: async (relativePath) => {
          throwIfAcquisitionAborted(input.signal);
          await this.faults.beforePublishRead?.(relativePath);
        },
        beforeSourceRead: async (relativePath) => {
          throwIfAcquisitionAborted(input.signal);
          await this.faults.beforePublishSourceRead?.(relativePath);
        },
      }, this.treeIo);
      await validateCanonicalTree(input.projectDir, result);
      // The agent wrote the stage; recovery adopts it as the baseline after a crash, so flush it before the commit.
      await syncManagedTree(stagePath, this.treeIo);
      this.faults.beforeDatabaseCommit?.();
      this.commit(id, input.projectId, input.expectedRevision, base.tree_digest, resultRevision, result);
    } catch (error) {
      releasePublication ??= await acquireArtifactProjectLock(this.db, input.projectId);
      const securityFailure = error instanceof ArtifactPublicationPolicyError ||
        (error instanceof Error && "code" in error && error.code === "immutable_reference_escaped");
      try {
        this.faults.beforeRollback?.();
        if (!securityFailure) await publishManagedTree(snapshotPath, input.projectDir);
        await validateCanonicalTree(input.projectDir, base);
      } finally {
        if (publicationStarted) endArtifactPublication(input.projectId);
        releasePublication();
      }
      this.terminal(id, "failed", null, null);
      if (securityFailure) {
        await rm(ownedRoot, { recursive: true, force: true });
        this.pruneFailedSecurityOperation(id);
      }
      publishArtifactOperationEvent(this.db, { projectId: input.projectId, operationId: id, revision: input.expectedRevision, digest: base.tree_digest, outcome: "failed", diff: [] });
      if (securityFailure) throw new ArtifactOperationError("immutable_reference_escaped", "immutable_reference_escaped");
      if (error instanceof ArtifactOperationError) throw error;
      if (error instanceof ExtractionAcquisitionError) throw error;
      // Sanitized domain errors raised while staging keep their own codes after rollback.
      if (error instanceof AcquisitionLimitError || error instanceof FigmaImportError) throw error;
      throw new ArtifactOperationError("operation_failed", error instanceof Error ? error.message : "Artifact operation failed");
    }
    try { this.faults.beforeBaselineFinalize?.(); await materializeManagedTree(stagePath, this.baselinePath(input.projectDir), this.treeIo); }
    catch (error) { console.warn("[artifact] committed operation requires baseline reconciliation", id, error); }
    finally { endArtifactPublication(input.projectId); releasePublication?.(); }
    publishArtifactOperationEvent(this.db, { projectId: input.projectId, operationId: id, revision: resultRevision, digest: result.tree_digest, outcome: "committed", diff });
    return { id, kind: input.kind, status: "committed", baseRevision: input.expectedRevision, baseDigest: base.tree_digest, resultRevision, resultDigest: result.tree_digest, diff };
  }

  async undo(input: UndoOperation): Promise<CommittedArtifactOperation> {
    await waitForStartupObservation(input.projectId);
    await this.validateBase(input.projectId, input.projectDir, input.expectedRevision, input.expectedArtifactDigest);
    const raw = this.db.query<PersistedArtifactOperationRow, [string, string]>("SELECT id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at FROM artifact_operations WHERE id=? AND project_id=?").get(input.operationId, input.projectId);
    if (raw === null) throw new ArtifactOperationError("undo_unavailable", "Committed operation is unavailable");
    const row = parsePersistedArtifactOperation(raw);
    if (row.status !== "committed") throw new ArtifactOperationError("undo_unavailable", "Committed operation is unavailable");
    // Imported Figma references are immutable; undoing the import would delete them.
    if (row.replay.kind === "figma_import") throw new ArtifactOperationError("undo_unavailable", "Imported references cannot be undone");
    const snapshot = row.snapshot;
    const retention = row.retention;
    if (!retention.replayable) throw new ArtifactOperationError("undo_pruned", "Retained bytes were pruned");
    try { await validateCanonicalTree(snapshot.snapshot_path, snapshot.base_manifest); }
    catch (error) { throw new ArtifactOperationError("undo_unavailable", error instanceof Error ? error.message : "Retained bytes are corrupt"); }
    const operation = await this.run({ projectId: input.projectId, projectDir: input.projectDir, kind: "undo", expectedRevision: input.expectedRevision, expectedArtifactDigest: input.expectedArtifactDigest, parentOperationId: input.operationId, mutate: async (stage) => { await materializeManagedTree(snapshot.snapshot_path, stage); } });
    if (operation.resultDigest !== row.base_digest) throw new ArtifactOperationError("undo_digest_mismatch", "Undo did not restore the historical digest");
    return operation;
  }

  /**
   * Re-apply an external save that was reverted because an operation was running. Only the captured
   * file changes are replayed, and only onto files still matching what the capture replaced.
   */
  async reapplyExternal(input: UndoOperation): Promise<CommittedArtifactOperation> {
    await this.validateBase(input.projectId, input.projectDir, input.expectedRevision, input.expectedArtifactDigest);
    const raw = this.db.query<PersistedArtifactOperationRow, [string, string]>("SELECT id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at FROM artifact_operations WHERE id=? AND project_id=?").get(input.operationId, input.projectId);
    if (raw === null) throw new ArtifactOperationError("reapply_unavailable", "Captured external edit is unavailable");
    const capture = parsePersistedArtifactOperation(raw);
    if (capture.status !== "conflicted" || capture.replay.kind !== "external") throw new ArtifactOperationError("reapply_unavailable", "Captured external edit is unavailable");
    if (!capture.retention.replayable || capture.retention.retained_until <= Date.now()) throw new ArtifactOperationError("capture_expired", "Captured external edit is no longer retained");
    if (this.db.query("SELECT 1 FROM artifact_operations WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1").get(input.projectId) !== null) throw new ArtifactOperationError("operation_conflict", "An artifact operation is active");
    const captured = resolveWithin(input.projectDir, ".meta", "artifact-operations", assertSafeName(capture.id), "stage");
    if (!sameStoragePath(capture.snapshot.stage_path, captured)) throw new ArtifactOperationError("reapply_unavailable", "Captured external edit is outside operation storage");
    return this.run({ projectId: input.projectId, projectDir: input.projectDir, kind: "reapply_external", expectedRevision: input.expectedRevision, expectedArtifactDigest: input.expectedArtifactDigest, parentOperationId: capture.id, mutate: async (stage) => {
      const current = await inspectCanonicalTree(stage);
      for (const file of capture.diff) {
        if ((manifestEntry(current, file.path)?.sha256 ?? null) !== file.before_hash) throw new ArtifactOperationError("reapply_conflict", "Files changed after the external edit was captured");
        const target = resolveWithin(stage, ...file.path.split("/"));
        if (file.after_hash === null) { await rm(target, { force: true }); continue; }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, await readFile(resolveWithin(captured, ...file.path.split("/"))));
      }
      const result = await inspectCanonicalTree(stage);
      if (capture.diff.some(file => (manifestEntry(result, file.path)?.sha256 ?? null) !== file.after_hash)) throw new ArtifactOperationError("reapply_unavailable", "Captured external edit bytes are corrupt");
    } });
  }

  async observeExternal(projectId: string, projectDir: string): Promise<CommittedArtifactOperation | null> {
    this.assertNotHeld(projectId);
    const release = await acquireArtifactProjectLock(this.db, projectId);
    try { return await this.observeExternalUntilStable(projectId, projectDir); }
    finally { release(); }
  }

  /**
   * Adopt settled on-disk bytes as the next revision without ever restoring the baseline.
   * `admit` runs under the project lock so callers can recheck their own preconditions there;
   * any active artifact operation refuses the adoption instead of taking the conflict path.
   */
  async adoptExternal(projectId: string, projectDir: string, admit: () => void): Promise<CommittedArtifactOperation | null> {
    this.assertNotHeld(projectId);
    await waitForStartupObservation(projectId);
    const release = await acquireArtifactProjectLock(this.db, projectId);
    try {
      admit();
      return await this.observeExternalUntilStable(projectId, projectDir, "refuse");
    } finally { release(); }
  }

  private async observeExternalUntilStable(projectId: string, projectDir: string, onActive: "reject" | "refuse" = "reject"): Promise<CommittedArtifactOperation | null> {
    if (isArtifactMutationBlockedByAlternatives(this.db, projectId, "")) {
      // Leased or quarantined by visual alternatives: never adopt or roll back live bytes now.
      if (onActive === "refuse") throw new ArtifactOperationError("operation_conflict", "Visual alternatives own this project");
      return null;
    }
    let latest: CommittedArtifactOperation | null = null;
    for (let pass = 0; pass < 8; pass += 1) {
      latest = await this.observeExternalOnce(projectId, projectDir, onActive) ?? latest;
      const live = await inspectCanonicalTree(projectDir);
      if (live.tree_digest === this.projectIdentity(projectId).digest) return latest;
    }
    // The committed baseline remains valid even if an external editor never settles.
    throw new ArtifactOperationError("external_changes_pending", "External files are still changing; retry after saving finishes");
  }

  private async observeExternalOnce(projectId: string, projectDir: string, onActive: "reject" | "refuse"): Promise<CommittedArtifactOperation | null> {
    const identity = this.projectIdentity(projectId);
    if (identity.digest === null) { await this.initializeOnce(projectId, projectDir); return null; }
    const stableIdentity = { revision: identity.revision, digest: identity.digest };
    const actual = await inspectCanonicalTree(projectDir);
    if (actual.tree_digest === stableIdentity.digest) return null;
    const baselinePath = this.baselinePath(projectDir);
    const base = await inspectCanonicalTree(baselinePath);
    if (base.tree_digest !== stableIdentity.digest) throw new ArtifactOperationError("recovery_unavailable", "Stable baseline does not match the database");
    const figmaReferences = await loadFigmaReferencePolicy(baselinePath, base);
    const active = this.db.query<{ readonly id: string }, [string]>("SELECT id FROM artifact_operations WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1").get(projectId);
    if (active !== null) {
      if (onActive === "refuse") throw new ArtifactOperationError("operation_conflict", "An artifact operation is active");
      return this.rejectExternal(projectId, projectDir, stableIdentity, actual, base, active.id);
    }
    const id = ulid();
    const ownedRoot = this.operationPath(projectDir, id);
    const snapshotPath = path.join(ownedRoot, "snapshot");
    const stagePath = path.join(ownedRoot, "stage");
    let registered = false;
    try {
    await materializeManagedTree(baselinePath, snapshotPath, this.treeIo);
    const captured = await materializeManagedTree(projectDir, stagePath, this.treeIo);
    this.faults.afterExternalCapture?.();
    const current = await inspectCanonicalTree(projectDir);
    if (captured.tree_digest !== current.tree_digest) return null;
    try {
      await assertFigmaReferencesPreserved(stagePath, figmaReferences);
      const stagedFigmaReferences = await loadFigmaReferencePolicy(
        stagePath,
        captured,
      );
      assertFigmaReferencePathsAllowed(captured, stagedFigmaReferences);
      assertFigmaManifestChangesAllowed(
        figmaReferences,
        stagedFigmaReferences,
        false,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "immutable_reference_escaped"
      ) {
        await publishManagedTree(snapshotPath, projectDir);
        throw new ArtifactOperationError(
          "immutable_reference_escaped",
          "immutable_reference_escaped",
        );
      }
      throw error;
    }
    const runInput = { projectId, projectDir, kind: "external" as const, expectedRevision: stableIdentity.revision, expectedArtifactDigest: stableIdentity.digest, mutate: async () => {} };
    this.insertWorking(id, runInput, base, snapshotPath, stagePath);
    registered = true;
    const diff = diffManagedTrees(base, captured);
    this.prepareResult(id, identity.revision + 1, captured, diff);
    this.commit(id, projectId, identity.revision, identity.digest, identity.revision + 1, captured);
    // Use the exact committed stage, never a later version of the live files.
    await materializeManagedTree(stagePath, baselinePath, this.treeIo);
    publishArtifactOperationEvent(this.db, { projectId, operationId: id, revision: identity.revision + 1, digest: captured.tree_digest, outcome: "committed", diff });
    return { id, kind: "external", status: "committed", baseRevision: identity.revision, baseDigest: identity.digest, resultRevision: identity.revision + 1, resultDigest: captured.tree_digest, diff };
    } catch (error) {
      if (!registered && error instanceof Error && "code" in error && error.code === "tree_mismatch") return null;
      throw error;
    } finally {
      if (!registered) await rm(ownedRoot, { recursive: true, force: true });
    }
  }

  private async rejectExternal(projectId: string, projectDir: string, identity: { readonly revision: number; readonly digest: string }, actual: CanonicalTreeManifest, base: CanonicalTreeManifest, activeId: string): Promise<CommittedArtifactOperation> {
    const id = ulid();
    const ownedRoot = this.operationPath(projectDir, id);
    const snapshotPath = path.join(ownedRoot, "snapshot");
    const stagePath = path.join(ownedRoot, "stage");
    await materializeManagedTree(this.baselinePath(projectDir), snapshotPath, this.treeIo);
    await materializeManagedTree(projectDir, stagePath, this.treeIo);
    const diff = diffManagedTrees(base, actual);
    await publishManagedTree(snapshotPath, projectDir);
    this.db.transaction(() => {
      this.db.prepare("UPDATE artifact_operations SET status='conflicted',result_revision=NULL,result_digest=NULL,diff_json='[]',replay_json=json_set(replay_json,'$.publication','base'),updated_at=? WHERE id=? AND status IN ('pending','working','recovering')").run(Date.now(), activeId);
      const now = Date.now();
      this.db.prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES (?,?,'conflicted',?,?,NULL,NULL,?,'','',?,?,?,?,?,?)").run(id, projectId, identity.revision, identity.digest, identity.revision, JSON.stringify(diff), JSON.stringify({ schema_version: 1, snapshot_path: snapshotPath, stage_path: stagePath, base_manifest: base }), JSON.stringify({ schema_version: 1, replayable: true, retained_until: now + RETENTION_MS, pruned_at: null, prune_reason: null }), JSON.stringify({ schema_version: 1, kind: "external", parent_operation_id: activeId, publication: "base" }), now, now);
    })();
    publishArtifactOperationEvent(this.db, { projectId, operationId: id, revision: identity.revision, digest: identity.digest, outcome: "conflicted", diff });
    return { id, kind: "external", status: "conflicted", baseRevision: identity.revision, baseDigest: identity.digest, resultRevision: identity.revision, resultDigest: identity.digest, diff };
  }

  private async validateBase(projectId: string, projectDir: string, revision: number, digest: string): Promise<CanonicalTreeManifest> {
    const identity = this.projectIdentity(projectId);
    if (identity.revision !== revision) throw new ArtifactOperationError("stale_revision", "Expected revision is stale");
    if (identity.digest !== digest) throw new ArtifactOperationError("stale_artifact_digest", "Expected artifact digest is stale");
    const actual = await inspectCanonicalTree(projectDir);
    if (actual.tree_digest !== digest) throw new ArtifactOperationError("artifact_identity_mismatch", "Live bytes do not match the stable digest");
    return actual;
  }

  private projectIdentity(projectId: string): ProjectIdentity {
    const row = this.db.query<{ readonly current_revision: number; readonly current_digest: string | null }, [string]>("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId);
    if (row === null) throw new ArtifactOperationError("project_not_found", "Project not found");
    return { revision: row.current_revision, digest: row.current_digest };
  }

  private insertWorking(id: string, input: Pick<RunOperation, "projectId" | "kind" | "expectedRevision" | "expectedFileHash" | "nodeFingerprint" | "parentOperationId">, base: CanonicalTreeManifest, snapshotPath: string, stagePath: string): void {
    const now = Date.now();
    const snapshot = { schema_version: 1, snapshot_path: snapshotPath, stage_path: stagePath, base_manifest: base };
    const retention = { schema_version: 1, replayable: true, retained_until: now + RETENTION_MS, pruned_at: null, prune_reason: null };
    const replay = { schema_version: 1, kind: input.kind, parent_operation_id: input.parentOperationId ?? null, publication: "base" };
    try { this.db.transaction(() => {
      const identity = this.projectIdentity(input.projectId);
      if (identity.revision !== input.expectedRevision || identity.digest !== base.tree_digest) throw new ArtifactOperationError("operation_conflict", "Stable artifact identity changed before staging");
      this.db.prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES (?,?, 'working',?,?,NULL,NULL,?,?,?,'[]',?,?,?,?,?)").run(id, input.projectId, input.expectedRevision, base.tree_digest, input.expectedRevision, input.expectedFileHash ?? "", input.nodeFingerprint ?? "", JSON.stringify(snapshot), JSON.stringify(retention), JSON.stringify(replay), now, now);
    })(); }
    catch (error) { throw new ArtifactOperationError("operation_conflict", error instanceof Error ? error.message : "Operation conflict"); }
  }

  private prepareResult(id: string, revision: number, manifest: CanonicalTreeManifest, diff: readonly ArtifactFileDiff[]): void {
    const changed = this.db.prepare("UPDATE artifact_operations SET result_revision=?,result_digest=?,diff_json=?,replay_json=json_set(replay_json,'$.publication','result'),updated_at=? WHERE id=? AND status='working'").run(revision, manifest.tree_digest, JSON.stringify(diff), Date.now(), id);
    if (changed.changes !== 1) throw new ArtifactOperationError("invalid_operation_state", "Operation is no longer working");
  }

  private commit(id: string, projectId: string, baseRevision: number, baseDigest: string, resultRevision: number, result: CanonicalTreeManifest): void {
    if (resultRevision !== baseRevision + 1) throw new ArtifactOperationError("invalid_result_revision", "Result revision must advance exactly once");
    this.db.transaction(() => {
      const project = this.db.prepare("UPDATE projects SET current_revision=?,current_digest=?,updated_at=? WHERE id=? AND current_revision=? AND current_digest=?").run(resultRevision, result.tree_digest, Date.now(), projectId, baseRevision, baseDigest);
      if (project.changes !== 1) throw new ArtifactOperationError("operation_conflict", "Stable artifact identity changed");
      const operation = this.db.prepare("UPDATE artifact_operations SET status='committed',updated_at=? WHERE id=? AND status IN ('working','recovering')").run(Date.now(), id);
      if (operation.changes !== 1) throw new ArtifactOperationError("invalid_operation_state", "Operation is not committable");
      this.faults.beforeFileIndex?.();
      replaceArtifactFileIndexInTransaction(this.db, projectId, result);
    })();
  }

  private pruneFailedSecurityOperation(id: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.replayable',json('false'),'$.retained_until',?,'$.pruned_at',?,'$.prune_reason','immutable_reference_escaped'),updated_at=? WHERE id=? AND status='failed'").run(now, now, now, id);
  }

  private terminal(id: string, status: "cancelled" | "failed" | "recovered", revision: number | null, digest: string | null): void {
    this.db.prepare("UPDATE artifact_operations SET status=?,result_revision=?,result_digest=?,replay_json=CASE WHEN ? IN ('failed','recovered') THEN json_set(replay_json,'$.publication','base') ELSE replay_json END,updated_at=? WHERE id=? AND status IN ('working','recovering')").run(status, revision, digest, status, Date.now(), id);
  }

  private operationPath(projectDir: string, id: string): string { return path.join(projectDir, ".meta", "artifact-operations", id); }
  private baselinePath(projectDir: string): string { return path.join(projectDir, ".meta", "artifact-baseline", "current"); }
}

function mergeImmutableReferencePaths(
  first: ReadonlyMap<string, ReadonlySet<string>>,
  second: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): ReadonlyMap<string, ReadonlySet<string>> {
  if (second === undefined || second.size === 0) return first;
  const output = new Map<string, Set<string>>();
  for (const source of [first, second]) {
    for (const [digest, paths] of source) {
      const existing = output.get(digest);
      if (existing === undefined) output.set(digest, new Set(paths));
      else for (const filePath of paths) existing.add(filePath);
    }
  }
  return output;
}

/** Compares a stored storage path with a resolveWithin result by real path, so symlinked, junctioned or 8.3-short project roots still match. */
function sameStoragePath(stored: string, resolved: string): boolean {
  try {
    const normalize = (value: string) => process.platform === "win32" ? realpathSync(value).toLowerCase() : realpathSync(value);
    return normalize(stored) === normalize(resolved);
  } catch { return false; }
}
