import { Database } from "bun:sqlite";
import { environment, expectedDigest, rulesAdapter, createInput } from "./system-content-fixture";
import { publishSystemContent, SYSTEM_CONTENT_BOUNDARIES } from "../../src/services/system-content-publication";

const [dbPath, root, rawMode, target, forcedRollback] = process.argv.slice(2);
if (dbPath === undefined || root === undefined || (rawMode !== "replace" && rawMode !== "create") || target === undefined || !SYSTEM_CONTENT_BOUNDARIES.some((name) => name === target) || forcedRollback !== undefined && forcedRollback !== "rollback") throw new TypeError("Invalid probe inputs");
const db = new Database(dbPath);
db.run("PRAGMA foreign_keys=ON");
const base = environment(db, root);
const rollbackBoundaries = new Set(["rollback-intent-recorded", "candidate-discarded", "base-restored", "rollback-recorded"]);
// Parent subscribes to stdout and exit before closing this trigger stream.
await new Response(Bun.stdin).text();
await publishSystemContent({
  ...base,
  atBoundary: async (name) => {
    if ((rollbackBoundaries.has(target) || forcedRollback === "rollback") && name === "candidate-validated") throw new TypeError("fixture_publish_failure");
    if (name === target) {
      await Bun.write(Bun.stdout, `BOUNDARY ${name}\n`);
      process.exit(73);
    }
  },
}, { systemId: "test-system", mode: rawMode, expectedDigest: await expectedDigest(base), adapter: rulesAdapter(), ...createInput(rawMode) });
throw new TypeError("Probe did not reach requested boundary");
