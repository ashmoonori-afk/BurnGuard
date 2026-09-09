import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb, getSqlite } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate-local";
import { reconcilePipelineRows } from "../../src/db/pipeline-repository";
import { systemsDir } from "../../src/lib/paths";
import { inspectCanonicalTree } from "../../src/services/canonical-tree-manifest";
import { buildExtractionProvenance } from "../../src/services/extraction-provenance";
import { reconcileExtractionState } from "../../src/services/extraction-recovery";

const outputPath = process.argv[2];
if (outputPath === undefined) throw new TypeError("Recovery probe output path is required");
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const exists = async (target: string): Promise<boolean> => (await stat(target).catch(() => null)) !== null;

await mkdir(systemsDir, { recursive: true });
await runMigrations();
const sqlite = getSqlite();
const now = 1;
const legacyDir = path.join(systemsDir, "legacy-valid");
const committedDir = path.join(systemsDir, "committed-marker");
const orphanStage = path.join(systemsDir, ".orphan-row.staging-11111111-1111-1111-1111-111111111111");
const reservationRoot = path.join(systemsDir, ".extraction-reservations");
const outsideDir = path.join(path.dirname(systemsDir), "outside-sentinel");
await Promise.all([
  mkdir(legacyDir, { recursive: true }),
  mkdir(path.join(committedDir, "fonts"), { recursive: true }),
  mkdir(orphanStage, { recursive: true }),
  mkdir(path.join(reservationRoot, "orphan-row"), { recursive: true }),
  mkdir(path.join(reservationRoot, "committed-marker"), { recursive: true }),
  mkdir(outsideDir, { recursive: true }),
]);
await writeFile(path.join(legacyDir, "README.md"), "legacy\n");
const sentinel = path.join(outsideDir, "sentinel.txt");
await writeFile(sentinel, "outside\n");
const provenance = buildExtractionProvenance([], 1);
await Promise.all([
  writeFile(path.join(committedDir, "README.md"), "# committed\n"),
  writeFile(path.join(committedDir, "SKILL.md"), "---\nname: committed\n---\n"),
  writeFile(path.join(committedDir, "colors_and_type.css"), ":root {}\n"),
  writeFile(path.join(committedDir, "fonts", "fonts.css"), ":root {}\n"),
  writeFile(path.join(committedDir, "extraction-provenance.json"), JSON.stringify(provenance)),
  writeFile(path.join(committedDir, ".burnguard-publication"), "owned-token"),
]);
const sidecarBefore = digest(await readFile(path.join(committedDir, "extraction-provenance.json"), "utf8"));
const insertSystem = sqlite.prepare("INSERT INTO design_systems (id,name,status,source_type,dir_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
insertSystem.run("legacy-valid", "Legacy", "draft", "website", legacyDir, now, now);
insertSystem.run("orphan-row", "Orphan", "draft", "website", path.join(systemsDir, "orphan-row"), now, now);
insertSystem.run("committed-marker", "Committed", "draft", "website", committedDir, now, now);
insertSystem.run("outside-row", "Outside", "draft", "website", outsideDir, now, now);
const manifest = await inspectCanonicalTree(committedDir);
sqlite.prepare("INSERT INTO design_system_receipts (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .run("receipt-committed", "committed-marker", "committed", 1, 1, provenance.content_digest, JSON.stringify(manifest), JSON.stringify(provenance), now, now);
const before = sqlite.query("SELECT id FROM design_systems WHERE id IN ('legacy-valid','orphan-row','committed-marker','outside-row') ORDER BY id").all();
reconcilePipelineRows(getDb(), 2);
const recovery = await reconcileExtractionState(3);
const after = sqlite.query("SELECT id FROM design_systems WHERE id IN ('legacy-valid','orphan-row','committed-marker','outside-row') ORDER BY id").all();
const receipt = sqlite.query("SELECT status,digest FROM design_system_receipts WHERE id='receipt-committed'").get();
const sidecarAfter = digest(await readFile(path.join(committedDir, "extraction-provenance.json"), "utf8"));
const result = {
  before,
  after,
  receipt,
  recovery,
  orphan_row_removed: sqlite.query("SELECT id FROM design_systems WHERE id='orphan-row'").get() === null,
  orphan_staging_removed: !(await exists(orphanStage)),
  orphan_reservation_removed: !(await exists(path.join(reservationRoot, "orphan-row"))),
  committed_marker_removed: !(await exists(path.join(committedDir, ".burnguard-publication"))),
  committed_files_preserved: await exists(path.join(committedDir, "README.md")),
  sidecar_digest_stable: sidecarBefore === sidecarAfter,
  legacy_preserved: sqlite.query("SELECT id FROM design_systems WHERE id='legacy-valid'").get() !== null,
  outside_row_preserved: sqlite.query("SELECT id FROM design_systems WHERE id='outside-row'").get() !== null,
  outside_sentinel: await readFile(sentinel, "utf8"),
};
await writeFile(outputPath, `${JSON.stringify(result)}\n`, "utf8");
sqlite.close();
