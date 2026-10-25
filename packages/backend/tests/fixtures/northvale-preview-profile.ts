import { Database } from "bun:sqlite";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NORTHVALE_PREVIEW_HISTORY } from "../../src/data/northvale-preview-history";
import { runMigrationsFrom } from "../../src/db/migrate";
import { resolveRepoRoot } from "../../src/lib/paths";
import { repairNorthvalePreviews } from "../../src/services/northvale-preview-repair";

export const sampleSource = path.join(resolveRepoRoot(), "design system sample");
export const legacySource = path.join(import.meta.dir, "northvale-legacy");
export const previewFiles = Object.keys(NORTHVALE_PREVIEW_HISTORY);

type Profile = {
  readonly db: Database;
  readonly systemsRoot: string;
  readonly installed: string;
  readonly paths: { readonly systemsRoot: string; readonly sourceRoot: string };
  readonly repair: () => ReturnType<typeof repairNorthvalePreviews>;
};

/** Every case owns its DB and filesystem; no shared northvale-capital row. */
export async function withNorthvaleProfile(action: (profile: Profile) => Promise<void>): Promise<void> {
  const systemsRoot = await mkdtemp(path.join(tmpdir(), "bg-northvale-"));
  const db = new Database(":memory:");
  try {
    await runMigrationsFrom(db, path.join(resolveRepoRoot(), "packages/backend/src/db/migrations"));
    const installed = path.join(systemsRoot, "northvale-capital");
    await mkdir(path.join(installed, "preview"), { recursive: true });
    for (const relative of previewFiles) {
      await cp(path.join(legacySource, relative), path.join(installed, relative));
    }
    await mkdir(path.join(installed, "uploads"));
    await writeFile(path.join(installed, "uploads", "reference.html"), "private fixture upload\n");
    await writeFile(path.join(installed, "custom.txt"), "custom fixture bytes\n");
    db.prepare(`INSERT INTO design_systems
      (id,name,status,source_type,is_template,dir_path,created_at,updated_at)
      VALUES ('northvale-capital','Northvale','published','sample',0,?,1,1)`).run(installed);
    const paths = { systemsRoot, sourceRoot: sampleSource };
    await action({ db, systemsRoot, installed, paths, repair: () => repairNorthvalePreviews(db, paths) });
  } finally {
    db.close();
    await rm(systemsRoot, { recursive: true, force: true });
  }
}

export async function previewBytes(installed: string): Promise<readonly Buffer[]> {
  return Promise.all(previewFiles.map(relative => readFile(path.join(installed, relative))));
}
