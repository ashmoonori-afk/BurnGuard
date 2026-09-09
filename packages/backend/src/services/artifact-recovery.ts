import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared/events";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";
import { materializeManagedTree, publishManagedTree } from "./artifact-tree-storage";
import { CanonicalTreeManifestError, inspectCanonicalTree, validateCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { parsePersistedArtifactOperation, type PersistedArtifactOperationRow } from "./artifact-operation-record";
import { publishArtifactOperationEvent } from "./artifact-operation-events";

type ProjectRow = { readonly id: string; readonly dir_path: string; readonly current_digest: string | null };
type RecoveryRow = PersistedArtifactOperationRow & { readonly dir_path: string };

type SnapshotReceipt = { readonly snapshotPath: string; readonly baseManifest: CanonicalTreeManifest };

export async function reconcileArtifactState(db: Database): Promise<{ readonly operations: number; readonly projects: number; readonly sessions: number }> {
  const operations = db.query<RecoveryRow, []>(`SELECT o.id,o.project_id,p.dir_path,o.status,o.base_revision,o.base_digest,o.result_revision,o.result_digest,o.expected_revision,o.expected_file_hash,o.node_fingerprint,o.diff_json,o.snapshot_json,o.retention_json,o.replay_json,o.created_at,o.updated_at
    FROM artifact_operations o JOIN projects p ON p.id=o.project_id WHERE o.status IN ('pending','working','recovering') ORDER BY o.created_at,o.id`).all();
  let recoveredOperations = 0;
  for (const operation of operations) {
    const parsed = parsePersistedArtifactOperation(operation);
    db.prepare("UPDATE artifact_operations SET status='recovering',updated_at=? WHERE id=?").run(Date.now(), parsed.id);
    await reconcileOperation(db, operation.dir_path, parsed);
    recoveredOperations += 1;
  }
  const projects = db.query<ProjectRow, []>("SELECT id,dir_path,current_digest FROM projects WHERE archived_at IS NULL ORDER BY id").all();
  const coordinator = new ArtifactCoordinator(db);
  for (const project of projects) {
    try {
      if (project.current_digest === null) await coordinator.initialize(project.id, project.dir_path);
      else {
        const actual = await inspectCanonicalTree(project.dir_path);
        if (actual.tree_digest !== project.current_digest) await coordinator.observeExternal(project.id, project.dir_path);
        else await coordinator.initialize(project.id, project.dir_path);
      }
    } catch (error) {
      if (!(error instanceof CanonicalTreeManifestError) || error.code !== "tree_missing") throw error;
      const now = Date.now();
      db.prepare("UPDATE projects SET archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL").run(now, now, project.id);
    }
  }
  const sessions = recoverPersistedSessions(db);
  return { operations: recoveredOperations, projects: projects.length, sessions };
}

async function reconcileOperation(db: Database, dirPath: string, operation: ReturnType<typeof parsePersistedArtifactOperation>): Promise<void> {
  const receipt = parseSnapshotReceipt(dirPath, operation.id, operation.snapshot);
  await validateCanonicalTree(receipt.snapshotPath, receipt.baseManifest);
  if (receipt.baseManifest.tree_digest !== operation.base_digest) throw new ArtifactOperationError("corrupt_receipt", "Snapshot digest differs from operation base");
  const live = await inspectCanonicalTree(dirPath);
  if (operation.result_revision !== null && operation.result_digest !== null && live.tree_digest === operation.result_digest) {
    db.transaction(() => {
      const project = db.prepare("UPDATE projects SET current_revision=?,current_digest=?,updated_at=? WHERE id=? AND current_revision=? AND current_digest=?").run(operation.result_revision, operation.result_digest, Date.now(), operation.project_id, operation.base_revision, operation.base_digest);
      if (project.changes !== 1) throw new ArtifactOperationError("operation_conflict", "Recovery project identity changed");
      db.prepare("UPDATE artifact_operations SET status='committed',updated_at=? WHERE id=? AND status='recovering'").run(Date.now(), operation.id);
    })();
    publishArtifactOperationEvent(db, { projectId: operation.project_id, operationId: operation.id, revision: operation.result_revision, digest: operation.result_digest, outcome: "committed", diff: operation.diff });
    return;
  }
  if (live.tree_digest !== operation.base_digest) {
    await publishManagedTree(receipt.snapshotPath, dirPath);
    await validateCanonicalTree(dirPath, receipt.baseManifest);
  }
  db.prepare("UPDATE artifact_operations SET status='recovered',result_revision=NULL,result_digest=NULL,diff_json='[]',replay_json=json_set(replay_json,'$.publication','base'),updated_at=? WHERE id=? AND status='recovering'").run(Date.now(), operation.id);
  publishArtifactOperationEvent(db, { projectId: operation.project_id, operationId: operation.id, revision: operation.base_revision, digest: operation.base_digest, outcome: "recovered", diff: operation.diff });
  await materializeManagedTree(dirPath, path.join(dirPath, ".meta", "artifact-baseline", "current"));
}

function parseSnapshotReceipt(dirPath: string, operationId: string, parsed: ReturnType<typeof parsePersistedArtifactOperation>["snapshot"]): SnapshotReceipt {
  const ownedRoot = path.resolve(dirPath, ".meta", "artifact-operations", operationId);
  const snapshotPath = path.resolve(parsed.snapshot_path);
  const stagePath = path.resolve(parsed.stage_path);
  if (snapshotPath !== path.join(ownedRoot, "snapshot") || stagePath !== path.join(ownedRoot, "stage")) throw new ArtifactOperationError("corrupt_receipt", "Artifact paths are not operation-owned");
  return { snapshotPath, baseManifest: parsed.base_manifest };
}

function recoverPersistedSessions(db: Database): number {
  const sessions = db.query<{ readonly id: string }, []>("SELECT id FROM sessions WHERE status IN ('running','awaiting_tool') ORDER BY id").all();
  for (const session of sessions) {
    const now = Date.now();
    const errorEvent: NormalizedEvent = { id: ulid(), ts: now, type: "status.error", message: "The previous process stopped before the turn completed.", recoverable: true };
    const idleEvent: NormalizedEvent = { id: ulid(), ts: now, type: "status.idle", stopReason: "error" };
    db.transaction(() => {
      persistRecoveryEvent(db, session.id, errorEvent, nextSequence(db, session.id));
      persistRecoveryEvent(db, session.id, idleEvent, nextSequence(db, session.id));
      db.prepare("UPDATE sessions SET status='idle',pid=NULL,updated_at=?,last_active_at=? WHERE id=?").run(now, now, session.id);
    })();
  }
  return sessions.length;
}

function nextSequence(db: Database, sessionId: string): number {
  return db.query<{ readonly next: number }, [string]>("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE session_id=?").get(sessionId)?.next ?? 1;
}
function persistRecoveryEvent(db: Database, sessionId: string, event: NormalizedEvent, sequence: number): void {
  db.prepare("INSERT INTO events(id,session_id,direction,type,payload_json,turn_id,processed_at,created_at,sequence) VALUES (?,?,'down',?,?,NULL,?,?,?)").run(event.id, sessionId, event.type, JSON.stringify(event), event.ts, event.ts, sequence);
}
