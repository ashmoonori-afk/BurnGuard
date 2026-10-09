import type { Database } from "bun:sqlite";
import { RecordedProcessRecoveryError, type OwnedProcessRecord } from "../adapters/owned-process-record";

export function recordSessionProcess(db: Database, sessionId: string, record: OwnedProcessRecord): string {
  const json = JSON.stringify(record);
  const result = db.prepare("UPDATE sessions SET pid=?,process_owner_json=?,updated_at=? WHERE id=? AND status IN ('running','awaiting_tool') AND process_owner_json IS NULL").run(record.pid, json, Date.now(), sessionId);
  if (result.changes !== 1) throw new RecordedProcessRecoveryError("Session process ownership changed before recording");
  return json;
}

export function clearSessionProcess(db: Database, sessionId: string, expectedJson: string): void {
  const result = db.prepare("UPDATE sessions SET pid=NULL,process_owner_json=NULL,updated_at=? WHERE id=? AND process_owner_json=?").run(Date.now(), sessionId, expectedJson);
  if (result.changes !== 1) throw new RecordedProcessRecoveryError("Session process ownership changed before cleanup");
}
