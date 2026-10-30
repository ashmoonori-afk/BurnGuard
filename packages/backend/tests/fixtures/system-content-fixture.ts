import { Database } from "bun:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrationsFrom } from "../../src/db/migrate";
import { defaultManagedTreeIo } from "../../src/services/artifact-tree-storage";
import { withSystemContentAccess } from "../../src/services/system-content-access";
import { contentObservationDigest, observeSystemContent, type ContentAdapter, type ContentEnvironment, type ContentValidator } from "../../src/services/system-content-publication";

export const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
export const OLD_RULES = '{"rules":["old"]}\r\n';
export const NEW_RULES = '{"rules":["new"]}\n';
export const validateRules: ContentValidator = async (root) => {
  if (await readFile(path.join(root, "rules.json"), "utf8") !== NEW_RULES) throw new TypeError("fixture_candidate_invalid");
};
export function rulesAdapter(): ContentAdapter {
  return {
    provenance: { format: "system-content-v1", writer: "rules", source_extraction: null },
    writeSet: () => ["rules.json"],
    transform: async (stage, _base, boundary) => {
      await writeFile(path.join(stage, "rules.json"), NEW_RULES);
      await boundary("stage-state-written");
      await boundary("stage-css-written");
    },
    validate: validateRules,
  };
}
export function environment(db: Database, systemsRoot: string): ContentEnvironment {
  return { db, systemsRoot, operationId: () => OPERATION_ID, now: () => 10, io: defaultManagedTreeIo, validators: { rules: validateRules } };
}
let migratedSchema: Promise<Uint8Array> | undefined;
export async function fixture(root: string, mode: "replace" | "create") {
  const systemsRoot = path.join(root, "systems");
  await mkdir(systemsRoot);
  const dbPath = path.join(root, "fixture.sqlite");
  // Migrate one empty schema, then give every case its own persistent database.
  // Publication/recovery still exercise real files, locks and isolated mutable rows.
  migratedSchema ??= (async () => {
    const template = new Database(":memory:");
    try {
      await runMigrationsFrom(template, path.join(import.meta.dir, "../../src/db/migrations"));
      return template.serialize();
    } finally { template.close(true); }
  })();
  await writeFile(dbPath, await migratedSchema);
  const db = new Database(dbPath);
  db.run("PRAGMA foreign_keys=ON");
  const live = path.join(systemsRoot, "test-system");
  if (mode === "replace") {
    await mkdir(path.join(live, ".git", "empty"), { recursive: true });
    await mkdir(path.join(live, "empty"));
    await writeFile(path.join(live, "rules.json"), OLD_RULES);
    await writeFile(path.join(live, "README.md"), "installed\r\n");
    await writeFile(path.join(live, ".git", "payload"), Buffer.from([0, 1, 255, 13, 10]));
    db.query("INSERT INTO design_systems(id,name,status,dir_path,created_at,updated_at) VALUES (?,?,'draft',?,1,1)").run("test-system", "Test", live);
  }
  return { db, dbPath, systemsRoot, live };
}
export const expectedDigestTraces = new Map<number, "queued_or_lock_io" | "observing_tree" | "releasing_lock">();
let nextTrace = 0;
export async function expectedDigest(env: ContentEnvironment): Promise<string> {
  const id = ++nextTrace;
  expectedDigestTraces.set(id, "queued_or_lock_io");
  const pending = withSystemContentAccess(env.db, env.systemsRoot, ["test-system"], async lease => {
    expectedDigestTraces.set(id, "observing_tree");
    const digest = contentObservationDigest(await observeSystemContent(env, "test-system", lease));
    expectedDigestTraces.set(id, "releasing_lock");
    return digest;
  });
  void pending.then(() => expectedDigestTraces.delete(id), () => expectedDigestTraces.delete(id));
  return pending;
}
export function createInput(mode: "replace" | "create") {
  return mode === "create" ? { create: { name: "Test", description: null, skillMdPath: null, tokensCssPath: null, readmeMdPath: null } } : {};
}
