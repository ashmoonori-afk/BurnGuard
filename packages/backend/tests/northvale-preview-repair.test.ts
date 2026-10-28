import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedSampleDesignSystems } from "../src/bootstrap";
import { bundledDesignSystemId, bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";
import { writeTextFileAtomically } from "../src/services/atomic-text-file";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { getCatalogSystem } from "../src/services/catalog-service";
import { repairNorthvalePreviews } from "../src/services/northvale-preview-repair";
import { legacySource, previewBytes, previewFiles, sampleSource, withNorthvaleProfile } from "./fixtures/northvale-preview-profile";

test("Given an absent sample When bootstrap seeds it Then the static source ships without uploads", async () => {
  await withNorthvaleProfile(async f => {
    // Other themes already exist; this case exercises only the real sample seed.
    await rm(f.installed, { recursive: true });
    await Promise.all(bundledDesignSystems.map(({ slug }) => mkdir(path.join(f.systemsRoot, bundledDesignSystemId(slug)))));
    await seedSampleDesignSystems(resolveRepoRoot(), f.systemsRoot);
    expect(await previewBytes(f.installed)).toEqual(await previewBytes(sampleSource));
    expect(await readdir(f.installed)).not.toContain("uploads");
    expect(await f.repair()).toMatchObject({ repaired: [], current: previewFiles, preserved: [], reason: null });
  });
});

for (const [version, ending, tokenFile] of [
  ["lf", "\n", "colors_and_type.css"],
  ["crlf", "\r\n", "colors_and_type.css"],
  ["before-layout", "\n", "tokens-before-layout.css"],
] as const) {
  test(`Given shipped ${version} sample bytes When startup repairs them Then all five assets advance and private files survive`, async () => {
    await withNorthvaleProfile(async f => {
      for (const relative of previewFiles) {
        const text = await readFile(path.join(legacySource, relative), "utf8");
        await writeFile(path.join(f.installed, relative), text.replaceAll("\r\n", "\n").replaceAll("\n", ending));
      }
      const tokens = await readFile(path.join(legacySource, tokenFile), "utf8");
      await writeFile(path.join(f.installed, "colors_and_type.css"), tokens.replaceAll("\r\n", "\n").replaceAll("\n", ending));
      const custom = await readFile(path.join(f.installed, "custom.txt"));
      const upload = await readFile(path.join(f.installed, "uploads/reference.html"));
      const before = await getCatalogSystem(f.db, f.systemsRoot, "northvale-capital");
      const result = await f.repair();
      expect(result).toEqual({ repaired: previewFiles, current: [], preserved: [], reason: null });
      expect(await previewBytes(f.installed)).toEqual(await previewBytes(sampleSource));
      expect(await readFile(path.join(f.installed, "custom.txt"))).toEqual(custom);
      expect(await readFile(path.join(f.installed, "uploads/reference.html"))).toEqual(upload);
      const after = await getCatalogSystem(f.db, f.systemsRoot, "northvale-capital");
      expect(after?.content.receipt_id).toBeNull();
      expect(after?.content.digest).not.toBe(before?.content.digest);
      expect(after?.content.digest).toBe((await inspectCanonicalTree(f.installed)).tree_digest);
    });
  });
}

test("Given an upgraded sample When startup runs twice more Then no file or receipt is written", async () => {
  await withNorthvaleProfile(async f => {
    await f.repair();
    const before = await inspectCanonicalTree(f.installed);
    const times = await Promise.all(previewFiles.map(relative => stat(path.join(f.installed, relative)).then(info => info.mtimeMs)));
    const rows = f.db.query("SELECT * FROM design_system_receipts").all();
    let writes = 0;
    for (let run = 0; run < 2; run += 1) {
      expect(await repairNorthvalePreviews(f.db, f.paths, async () => { writes += 1; })).toMatchObject({
        repaired: [], current: previewFiles, preserved: [], reason: null,
      });
    }
    expect(writes).toBe(0);
    expect(await inspectCanonicalTree(f.installed)).toEqual(before);
    expect(await Promise.all(previewFiles.map(relative => stat(path.join(f.installed, relative)).then(info => info.mtimeMs)))).toEqual(times);
    expect(f.db.query("SELECT * FROM design_system_receipts").all()).toEqual(rows);
  });
});

for (const published of [1, 2, 3, 4, 5]) {
  test(`Given startup interrupted after publication ${published} When repair restarts Then it converges without rewriting published files`, async () => {
    await withNorthvaleProfile(async f => {
      const interruption = new Error("fixture_interruption");
      let writes = 0;
      await expect(repairNorthvalePreviews(f.db, f.paths, async (target, text) => {
        await writeTextFileAtomically(target, text);
        if (++writes === published) throw interruption;
      })).rejects.toBe(interruption);
      const result = await f.repair();
      expect(result.repaired).toEqual(previewFiles.slice(published));
      expect(result.current).toEqual(previewFiles.slice(0, published));
      expect(result.preserved).toEqual([]);
      expect(await previewBytes(f.installed)).toEqual(await previewBytes(sampleSource));
      expect((await f.repair()).repaired).toEqual([]);
    });
  });
}

test("Given a customized preview When startup repairs known siblings Then the custom bytes remain and the result is partial", async () => {
  await withNorthvaleProfile(async f => {
    const custom = Buffer.from("<!doctype html><p>Custom palette</p>\n");
    await writeFile(path.join(f.installed, "preview/colors-neutrals.html"), custom);
    const result = await f.repair();
    expect(result.preserved).toEqual(["preview/colors-neutrals.html"]);
    expect(result.reason).toBe("file_identity");
    expect(result.repaired).toHaveLength(4);
    expect(await readFile(path.join(f.installed, "preview/colors-neutrals.html"))).toEqual(custom);
  });
});

test("Given customized tokens without full ramps When repair runs Then token bytes and their dependent ramp page stay intact", async () => {
  await withNorthvaleProfile(async f => {
    const custom = (await readFile(path.join(f.installed, "colors_and_type.css"), "utf8")) + "\n:root { --gray-10: #123456; }\n";
    await writeFile(path.join(f.installed, "colors_and_type.css"), custom);
    const ramp = await readFile(path.join(f.installed, "preview/colors-ramps.html"));
    const result = await f.repair();
    expect(result.preserved).toEqual(["colors_and_type.css", "preview/colors-ramps.html"]);
    expect(result.repaired).toHaveLength(3);
    expect(await readFile(path.join(f.installed, "colors_and_type.css"), "utf8")).toBe(custom);
    expect(await readFile(path.join(f.installed, "preview/colors-ramps.html"))).toEqual(ramp);
  });
});

test("Given a missing preview When repair runs Then it is preserved as missing rather than reseeded", async () => {
  await withNorthvaleProfile(async f => {
    await rm(path.join(f.installed, "preview/colors-charts.html"));
    const result = await f.repair();
    expect(result.preserved).toEqual(["preview/colors-charts.html"]);
    expect(await readdir(path.join(f.installed, "preview"))).not.toContain("colors-charts.html");
  });
});

for (const status of ["prepared", "recovering", "committed", "failed"] as const) {
  test(`Given a ${status} content receipt When sample repair runs Then both the owned tree and receipt remain unchanged`, async () => {
    await withNorthvaleProfile(async f => {
      const manifest = await inspectCanonicalTree(f.installed);
      f.db.prepare(`INSERT INTO design_system_receipts
        (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at)
        VALUES ('owned','northvale-capital',?,1,1,?,?,'{}',1,1)`).run(status, manifest.tree_digest, JSON.stringify(manifest));
      const rows = f.db.query("SELECT * FROM design_system_receipts").all();
      expect(await f.repair()).toEqual({ repaired: [], current: [], preserved: previewFiles, reason: "receipt_owned" });
      expect(await inspectCanonicalTree(f.installed)).toEqual(manifest);
      expect(f.db.query("SELECT * FROM design_system_receipts").all()).toEqual(rows);
    });
  });
}

for (const flavor of [path.posix, path.win32]) {
  test(`Given a foreign ${flavor.sep === "/" ? "POSIX" : "Windows"} DB path When repair runs Then no managed bytes change`, async () => {
    await withNorthvaleProfile(async f => {
      const before = await previewBytes(f.installed);
      const foreign = flavor.join(flavor.sep === "/" ? "/outside" : "C:\\outside", "northvale-capital");
      f.db.prepare("UPDATE design_systems SET dir_path=? WHERE id='northvale-capital'").run(foreign);
      expect((await f.repair()).reason).toBe("system_identity");
      expect(await previewBytes(f.installed)).toEqual(before);
    });
  });
}

for (const location of ["inside", "outside"] as const) {
  test(`Given a ${location} preview directory link or junction When repair runs Then neither target nor uploads are changed`, async () => {
    await withNorthvaleProfile(async f => {
      const preview = path.join(f.installed, "preview");
      const redirected = path.join(location === "inside" ? f.installed : f.systemsRoot, "redirected");
      await rename(preview, redirected);
      await symlink(redirected, preview, process.platform === "win32" ? "junction" : "dir");
      const before = await inspectCanonicalTree(redirected);
      const result = await f.repair();
      expect(result.preserved).toEqual(previewFiles.slice(1));
      expect(await inspectCanonicalTree(redirected)).toEqual(before);
      expect(await readFile(path.join(f.installed, "uploads/reference.html"), "utf8")).toBe("private fixture upload\n");
    });
  });
}

test("Given a hard-linked shipped file When repair runs Then both names retain the original bytes", async () => {
  await withNorthvaleProfile(async f => {
    const original = path.join(f.installed, "preview/colors-charts.html");
    const alias = path.join(f.installed, "custom-chart.html");
    await link(original, alias);
    const before = createHash("sha256").update(await readFile(original)).digest("hex");
    expect((await f.repair()).preserved).toEqual(["preview/colors-charts.html"]);
    for (const target of [original, alias]) expect(createHash("sha256").update(await readFile(target)).digest("hex")).toBe(before);
  });
});
