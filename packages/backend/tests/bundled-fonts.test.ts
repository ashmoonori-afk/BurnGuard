import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyBundledFonts } from "../src/data/bundled-fonts";
import { createProjectRecord } from "../src/db/seed";
import { PROTOTYPE_TUTORIAL_NAME, seedTutorialsOnce } from "../src/db/seed-tutorials";
import { appRootDir, resolveRepoRoot } from "../src/lib/paths";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { getSqlite } from "../src/db/client";
import { DECK_STAGE_JS } from "../src/runtime/deck-stage";
import { isRuntimeSource } from "../../../scripts/package-runtime";

test("Given bundled local fonts, when initializing projects and copying over brand assets, then font bytes are durable and supplied files survive", async () => {
  const css = await readFile(path.join(resolveRepoRoot(), "assets/fonts/fonts.css"), "utf8");
  for (const type of ["prototype", "graphic", "slide_deck"] as const) {
    const project = await createProjectRecord({ name: "Font starter", type, designSystemId: null, backendId: "codex", optionsJson: type === "graphic" ? JSON.stringify({ graphic_canvas: { schema_version: 1, width: 1080, height: 1350 } }) : null, entrypoint: type === "slide_deck" ? "deck.html" : "index.html", thumbnailPath: null });
    expect(await readFile(path.join(project.dir_path, "fonts/fonts.css"), "utf8")).toBe(css);
    expect(await readFile(path.join(project.dir_path, project.entrypoint), "utf8")).toContain('href="fonts/fonts.css"');
    if (type === "slide_deck") {
      expect(await readFile(path.join(project.dir_path, "runtime/deck-stage.js"), "utf8")).toBe(DECK_STAGE_JS);
      expect(await readFile(path.join(project.dir_path, project.entrypoint), "utf8")).toContain('src="runtime/deck-stage.js" defer');
    }
    const row = getSqlite().prepare("SELECT current_digest FROM projects WHERE id=?").get(project.id) as { current_digest: string };
    expect((await inspectCanonicalTree(project.dir_path)).tree_digest).toBe(row.current_digest);
  }
  const branded = path.join(appRootDir, "brand-copy-test");
  await mkdir(path.join(branded, "fonts"), { recursive: true });
  await writeFile(path.join(branded, "fonts/fonts.css"), "existing brand CSS");
  await copyBundledFonts(branded);
  expect(await readFile(path.join(branded, "fonts/fonts.css"), "utf8")).toBe("existing brand CSS");
  expect(await readFile(path.join(branded, "fonts/Pretendard-OFL.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE");
  expect(isRuntimeSource("assets/fonts/fonts.css")).toBe(true);
  expect(isRuntimeSource("assets/fonts/../../secret")).toBe(false);
});

test("Given an existing tutorial project When startup seeding runs again Then its live files are not mutated", async () => {
  await seedTutorialsOnce();
  const project = getSqlite().query<{ readonly dirPath: string }, [string]>("SELECT dir_path dirPath FROM projects WHERE name=?").get(PROTOTYPE_TUTORIAL_NAME);
  if (project === null) throw new Error("tutorial fixture was not seeded");
  const missingFont = path.join(project.dirPath, "fonts", "Pretendard-OFL.txt");
  await rm(missingFont);

  await seedTutorialsOnce();

  await expect(readFile(missingFont)).rejects.toThrow();
});
