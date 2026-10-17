import path from "node:path";
import { Database } from "bun:sqlite";
import { reconcileArtifactState } from "../../src/services/artifact-recovery";

/**
 * Child process for photo-record-crash-recovery.test.ts: a fresh start on the state the crash worker left behind.
 * It runs real startup reconciliation and prints the result as one JSON line, so the test process never opens the
 * SQLite file itself and every handle is released when this process exits.
 * Usage: bun photo-recovery-runner.ts <temp dir>
 */
const temp = process.argv[2];
if (temp === undefined) throw new Error("usage: photo-recovery-runner.ts <temp dir>");

const db = new Database(path.join(temp, "state.sqlite"));
const recovery = await reconcileArtifactState(db);
const project = db.query<{ current_revision: number }, []>("SELECT current_revision FROM projects WHERE id='p'").get();
console.log(JSON.stringify({ recovery, revision: project?.current_revision ?? null }));
db.close();
