import path from "node:path";
import { eq } from "drizzle-orm";
import { copyOriginalSample, originalSamples, originalSampleFormats, originalSampleSystemId, ORIGINAL_SAMPLE_TAG } from "../data/original-samples";
import { systemsDir } from "../lib/paths";
import { getDb, getSqlite } from "./client";
import { designSystemsTable } from "./schema";

/** Durable per-item receipts preserve edits and deletions across app updates. */
export async function seedOriginalSamplesOnce(): Promise<void> {
  const db = getDb();
  const sqlite = getSqlite();
  const completed = (key: string) => sqlite.prepare("SELECT 1 FROM meta_schema WHERE key=?").get(key) !== null;
  const complete = (key: string) => sqlite.prepare("INSERT OR IGNORE INTO meta_schema(key,value) VALUES (?, '1')").run(key);
  const { createProjectRecord } = await import("./seed");
  for (const sample of originalSamples) {
    const id = originalSampleSystemId(sample.slug);
    const systemKey = `seed:original:v1:${sample.slug}:system`;
    if (!completed(systemKey)) {
      const existing = await db.select({ id: designSystemsTable.id }).from(designSystemsTable).where(eq(designSystemsTable.id, id));
      if (!existing.length) {
        const dirPath = path.join(systemsDir, id);
        await copyOriginalSample(sample.slug, "design-system", dirPath);
        const now = Date.now();
        await db.insert(designSystemsTable).values({ id, name: `${sample.name} Design System`, description: sample.description, status: "published", sourceType: "sample", isTemplate: true, dirPath, skillMdPath: path.join(dirPath, "SKILL.md"), tokensCssPath: path.join(dirPath, "colors_and_type.css"), readmeMdPath: path.join(dirPath, "README.md"), thumbnailPath: `/api/design-systems/${id}/files/assets/hero.png`, createdAt: now, updatedAt: now }).onConflictDoNothing();
      }
      complete(systemKey);
    }
    for (const format of originalSampleFormats) {
      const key = `seed:original:v1:${sample.slug}:${format.type}`;
      if (completed(key)) continue;
      const name = `${ORIGINAL_SAMPLE_TAG} ${sample.name} · ${format.label}`;
      // A crash after publication but before the seed receipt must not duplicate a project.
      if (!sqlite.prepare("SELECT 1 FROM projects WHERE name=?").get(name)) {
        await createProjectRecord({ name, type: format.type, designSystemId: id, backendId: format.type === "graphic" ? "codex" : "claude-code", optionsJson: null, entrypoint: format.entrypoint, thumbnailPath: null });
      }
      complete(key);
    }
  }
}
