import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedBundledDesignSystems, seedSampleDesignSystems } from "../src/bootstrap";
import { bundledDesignSystemId, bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";
import { reconcileExtractionPublications } from "../src/services/extraction-publication";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** Every bundled theme except `pending` is already seeded, so exactly one theme does work and each call settles deterministically. */
async function fixture(pending: string | null): Promise<{ readonly repo: string; readonly systems: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-seed-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const systems = path.join(root, "systems");
  await mkdir(repo);
  await Promise.all(bundledDesignSystems.filter(({ slug }) => slug !== pending).map(({ slug }) => mkdir(path.join(systems, bundledDesignSystemId(slug)), { recursive: true })));
  return { repo, systems };
}

const hidden = async (systems: string): Promise<string[]> => (await readdir(systems)).filter((name) => name.startsWith("."));

describe("first-run design-system seeding", () => {
  test("Given a theme whose font bundle cannot be copied When seeding fails Then no partial theme is published and a later seed completes it", async () => {
    const { repo, systems } = await fixture("retro");
    // The repo has the theme source but no assets/fonts, so the copy fails after the theme files were written.
    await cp(path.join(resolveRepoRoot(), "design system themes", "retro"), path.join(repo, "design system themes", "retro"), { recursive: true });

    await expect(seedBundledDesignSystems(repo, systems)).rejects.toThrow();

    expect(existsSync(path.join(systems, bundledDesignSystemId("retro")))).toBe(false);
    expect(await hidden(systems)).toEqual([]);

    await seedBundledDesignSystems(resolveRepoRoot(), systems);

    expect(existsSync(path.join(systems, bundledDesignSystemId("retro"), "fonts", "fonts.css"))).toBe(true);
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given seed stages left by a first launch killed mid-copy When startup recovery runs Then they are removed", async () => {
    const { systems } = await fixture(null);
    for (const id of [bundledDesignSystemId("retro"), "northvale-capital"]) await mkdir(path.join(systems, `.${id}.staging-${randomUUID()}`, "fonts"), { recursive: true });

    expect((await reconcileExtractionPublications(systems)).removed_staging).toBe(2);
    expect(await hidden(systems)).toEqual([]);
  });

  // A FIFO makes the copy fail midway; Windows has no mkfifo.
  test.skipIf(process.platform === "win32")("Given the sample system copy fails midway When seeding fails Then no partial sample is published and a later seed completes it", async () => {
    const { repo, systems } = await fixture(null);
    const sample = path.join(repo, "design system sample");
    await mkdir(sample);
    await writeFile(path.join(sample, "README.md"), "# fixture\n");
    const fifo = path.join(sample, "zz-pipe");
    expect(await Bun.spawn(["mkfifo", fifo]).exited).toBe(0);

    await expect(seedSampleDesignSystems(repo, systems)).rejects.toThrow();

    expect(existsSync(path.join(systems, "northvale-capital"))).toBe(false);
    expect(await hidden(systems)).toEqual([]);

    await rm(fifo);
    await seedSampleDesignSystems(repo, systems);

    expect(existsSync(path.join(systems, "northvale-capital", "README.md"))).toBe(true);
    expect(await hidden(systems)).toEqual([]);
  });
});
