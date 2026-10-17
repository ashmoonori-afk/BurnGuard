import type { Database } from "bun:sqlite";
import { parseOwnedProcessRecord, reapRecordedProcess, type RecordedProcessReaper } from "../adapters/owned-process-record";
import { clearSessionProcess } from "../db/session-process";

/** Run before any filesystem reconciliation, including for an idle failed turn. */
export async function reapPersistedSessionProcesses(db: Database, reaper?: RecordedProcessReaper): Promise<void> {
  const rows = db.query<{ readonly id: string; readonly process_owner_json: string }, []>("SELECT id,process_owner_json FROM sessions WHERE process_owner_json IS NOT NULL ORDER BY id").all();
  for (const row of rows) {
    const record = parseOwnedProcessRecord(row.process_owner_json);
    await reapRecordedProcess(record, reaper);
    clearSessionProcess(db, row.id, row.process_owner_json);
  }
}
