import { createDefaultPalette, serializePalette } from "@bg/shared/palette";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { bootstrapLocalAppData } from "../../src/bootstrap";
import { closeSqlite, getSqlite } from "../../src/db/sqlite-client";
import { runMigrations } from "../../src/db/migrate-local";
import { systemsDir } from "../../src/lib/paths";
import { getCurrentSystemContent } from "../../src/db/catalog-repository";
import { inspectCanonicalTree } from "../../src/services/canonical-tree-manifest";
import { buildExtractionProvenance } from "../../src/services/extraction-provenance";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../../src/services/design-system-palette";
import { inspectContentTree } from "../../src/services/system-content-tree";

const [phase, output, outcome] = process.argv.slice(2);
if (output === undefined || (phase !== "prepare" && phase !== "recover") || (outcome !== "publish" && outcome !== "hold")) {
  throw new TypeError("Expected prepare/recover, output path and publish/hold");
}
const live = path.join(systemsDir, "splash");
const exists = async (target: string) => await stat(target).then(() => true, error => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
  throw error;
});
if (phase === "prepare") {
  await mkdir(path.join(live, "fonts"), { recursive: true });
  await runMigrations();
  const db = getSqlite();
  // A source row can have locally authored v2 content without any v1 extraction receipt.
  // Its committed-but-missing tree is corruption, not extraction's receipt-free orphan.
  const v2Only = path.join(systemsDir, "v2-only-extracted");
  await mkdir(v2Only);
  await writeFile(path.join(v2Only, "README.md"), "# Local authored baseline\n");
  db.query(`INSERT INTO design_systems(id,name,status,source_type,dir_path,created_at,updated_at)
    VALUES ('v2-only-extracted','V2 only','published','website',?,1,1)`).run(v2Only);
  const v2Env = paletteContentEnvironment();
  const v2Current = await readDesignSystemPalette("v2-only-extracted", v2Env);
  await saveDesignSystemPalette("v2-only-extracted", {
    expected_digest: v2Current.expected_digest, state: createDefaultPalette(),
  }, v2Env);
  await rename(v2Only, path.join(systemsDir, ".v2-only-preserved"));
  const provenance = JSON.stringify(buildExtractionProvenance([], 1));
  for (const [name, bytes] of Object.entries({
    "README.md": "# Installed splash\r\n", "SKILL.md": "# Installed skill\r\n",
    "colors_and_type.css": ":root { --legacy: #112233; }\r\n", "fonts/custom.woff2": "private-font",
    "fonts/fonts.css": "/* Installed font definitions */\r\n",
    "extraction-provenance.json": provenance, ".burnguard-publication": "old-extraction-marker",
  })) await writeFile(path.join(live, name), bytes);
  await mkdir(path.join(live, "fonts/empty"));
  db.query(`INSERT INTO design_systems(id,name,status,source_type,dir_path,skill_md_path,tokens_css_path,readme_md_path,created_at,updated_at)
    VALUES ('splash','Installed','published','website',?,?,?,?,1,1)`).run(
    live, ...["SKILL.md", "colors_and_type.css", "README.md"].map(name => path.join(live, name)),
  );
  const manifest = await inspectCanonicalTree(live);
  db.query(`INSERT INTO design_system_receipts(id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at)
    VALUES ('splash-extraction','splash','committed',1,1,?,?,?,1,1)`).run(
    buildExtractionProvenance([], 1).content_digest, JSON.stringify(manifest), provenance,
  );
  await writeFile(output, JSON.stringify({
    before: (await inspectContentTree(live)).inventory,
    extraction: db.query("SELECT * FROM design_system_receipts WHERE id='splash-extraction'").get(),
    metadata: db.query("SELECT * FROM design_systems WHERE id='splash'").get(),
  }));
  const env = paletteContentEnvironment();
  const current = await readDesignSystemPalette("splash", env);
  await saveDesignSystemPalette("splash", { expected_digest: current.expected_digest, state: createDefaultPalette() }, {
    ...env, operationId: () => "11111111-1111-4111-8111-111111111111",
    atBoundary: async name => {
      if (name !== "base-moved") return;
      if (outcome === "hold") await writeFile(
        path.join(systemsDir, ".system-content/11111111-1111-4111-8111-111111111111/previous/README.md"), "external backup edit",
      );
      // A genuine process exit bypasses the publisher's rollback/finally.
      process.exit(77);
    },
  });
  throw new Error("Crash boundary was not reached");
}

const baseline: unknown = JSON.parse(await readFile(output, "utf8"));
// This is the real startup entry, not a private recovery helper.
await bootstrapLocalAppData();
const db = getSqlite();
const head = getCurrentSystemContent(db, "splash");
const present = await exists(live);
const inventory = present ? (await inspectContentTree(live)).inventory : null;
await writeFile(output, JSON.stringify({
  baseline, present, head,
  extraction: db.query("SELECT * FROM design_system_receipts WHERE id='splash-extraction'").get(),
  metadata: db.query("SELECT * FROM design_systems WHERE id='splash'").get(),
  pending: db.query("SELECT status FROM design_system_receipts WHERE design_system_id='splash' AND status IN ('prepared','recovering')").get(),
  v2_only_row_preserved: db.query("SELECT 1 FROM design_systems WHERE id='v2-only-extracted'").get() !== null,
  v2_only_live_missing: !(await exists(path.join(systemsDir, "v2-only-extracted"))),
  v2_only_backup_preserved: await exists(path.join(systemsDir, ".v2-only-preserved/palette/state.json")),
  inventory,
  saved_json: present ? await readFile(path.join(live, "palette/state.json"), "utf8") : null,
  expected_json: serializePalette(createDefaultPalette()),
  fonts: present ? (await readdir(path.join(live, "fonts"))).sort() : null,
  backup: await exists(path.join(systemsDir, ".system-content/11111111-1111-4111-8111-111111111111/previous")),
}));
closeSqlite();
