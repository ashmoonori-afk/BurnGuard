import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { originalSamples, originalSampleFormats, originalSampleSystemId, ORIGINAL_SAMPLE_TAG } from "../src/data/original-samples";
import { seedOriginalSamplesOnce } from "../src/db/seed-original-samples";
import { createProjectRecord, listHomeProjects } from "../src/db/seed";
import { getSqlite } from "../src/db/client";
import { resolveRepoRoot } from "../src/lib/paths";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { createApp } from "../src/server";

test("Given original samples, when seeded and copied, then all formats have durable assets and deletion stays deleted", async () => {
  await seedOriginalSamplesOnce();
  const db = getSqlite();
  const app = createApp({ capability: "original-samples-test", appAuthority: "original.test" });
  const headers = { Host: "original.test", "x-burnguard-capability": "original-samples-test" };
  const rows = db.query<{ id: string; name: string; type: string; dir_path: string; entrypoint: string; current_digest: string; options_json: string | null }, []>("SELECT * FROM projects WHERE name LIKE '[burnguard:original-sample]%'").all();
  expect(rows).toHaveLength(12);
  for (const sample of originalSamples) {
    const system = db.prepare("SELECT status,is_template FROM design_systems WHERE id=?").get(originalSampleSystemId(sample.slug));
    expect(system).toEqual({ status: "published", is_template: 1 });
    const systemId = originalSampleSystemId(sample.slug);
    const previews = await app.request(`http://original.test/api/design-systems/${systemId}/previews`, { headers });
    expect(previews.status).toBe(200);
    expect(await previews.json()).toEqual({ data: [{ path: "preview.html" }] });
    const thumbnail = `/api/design-systems/${systemId}/files/assets/hero.png`;
    const detail = await app.request(`http://original.test/api/design-systems/${systemId}`, { headers });
    expect(detail.status).toBe(200);
    expect((await detail.json()).data.thumbnail_path).toBe(thumbnail);
    const image = await app.request(`http://original.test${thumbnail}`, { headers });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/png");
    for (const format of originalSampleFormats) {
      const row = rows.find((item) => item.name === `${ORIGINAL_SAMPLE_TAG} ${sample.name} · ${format.label}`)!;
      expect(row.type).toBe(format.type);
      expect(db.prepare("SELECT backend_id FROM sessions WHERE project_id=?").get(row.id)).toEqual({ backend_id: format.type === "graphic" ? "codex" : "claude-code" });
      expect(row.entrypoint).toBe(format.entrypoint);
      expect((await inspectCanonicalTree(row.dir_path)).tree_digest).toBe(row.current_digest);
      const source = path.join(resolveRepoRoot(), "samples/original", sample.slug);
      expect(await readFile(path.join(row.dir_path, "assets/hero.png"))).toEqual(await readFile(path.join(source, "assets/hero.png")));
      if (format.type === "graphic") expect(JSON.parse(row.options_json!).graphic_canvas).toEqual({ schema_version: 1, width: 1080, height: 1350 });
      const clone = await createProjectRecord({ name: `My ${sample.name} ${format.label}`, type: format.type, designSystemId: originalSampleSystemId(sample.slug), backendId: format.type === "graphic" ? "codex" : "claude-code", optionsJson: null, entrypoint: format.entrypoint, thumbnailPath: null });
      expect(await readFile(path.join(clone.dir_path, clone.entrypoint))).toEqual(await readFile(path.join(row.dir_path, row.entrypoint)));
      expect(await readFile(path.join(clone.dir_path, "assets/hero.png"))).toEqual(await readFile(path.join(row.dir_path, "assets/hero.png")));
    }
  }
  expect((await listHomeProjects("examples", 100, 0)).items.filter((row) => row.name.startsWith(ORIGINAL_SAMPLE_TAG))).toHaveLength(12);
  expect((await listHomeProjects("mine", 100, 0)).items.filter((row) => row.name.startsWith(ORIGINAL_SAMPLE_TAG))).toHaveLength(0);
  const deleted = rows[0]!;
  const edited = rows[1]!;
  db.prepare("DELETE FROM projects WHERE id=?").run(deleted.id);
  await writeFile(path.join(edited.dir_path, edited.entrypoint), "user edited sample");
  await seedOriginalSamplesOnce();
  expect(db.prepare("SELECT 1 FROM projects WHERE name=?").get(deleted.name)).toBeNull();
  expect(await readFile(path.join(edited.dir_path, edited.entrypoint), "utf8")).toBe("user edited sample");
}, 60_000);
