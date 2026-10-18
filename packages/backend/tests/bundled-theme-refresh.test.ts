import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedBundledDesignSystems } from "../src/bootstrap";
import { bundledDesignSystemId, bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";
import {
  bundledThemeHistory, readThemeFiles, refreshBundledTheme, themeFileHash, themeTreeDigest, type BundledThemeHistory, type BundledThemeRefresh,
} from "../src/services/bundled-theme-refresh";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const SLUG = "light";
const source = path.join(resolveRepoRoot(), "design system themes", SLUG);
const legacyTheme = {
  "README.md": "# Light\nOlder palette notes.\n",
  "SKILL.md": "# Light\nUse the older palette.\n",
  "colors_and_type.css": ":root { --gray-90: #09090B; }\n",
};
const retiredRuntime = "export const glass = true;\n";

/** Profile from an older release: every other theme is already current or edited, so only `light` can change. */
async function upgradedProfile(files: Readonly<Record<string, string>>): Promise<{ readonly systems: string; readonly installed: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-theme-refresh-"));
  roots.push(root);
  const systems = path.join(root, "systems");
  await Promise.all(bundledDesignSystems.filter(({ slug }) => slug !== SLUG).map(({ slug }) => mkdir(path.join(systems, bundledDesignSystemId(slug)), { recursive: true })));
  const installed = path.join(systems, bundledDesignSystemId(SLUG));
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(installed, relative)), { recursive: true });
    await writeFile(path.join(installed, relative), text);
  }
  return { systems, installed };
}

const legacyHistory: BundledThemeHistory = {
  themes: { [SLUG]: [themeTreeDigest(new Map(Object.entries(legacyTheme).map(([file, text]) => [file, themeFileHash(Buffer.from(text))])))] },
  retired: { "liquid-glass/liquid-glass.mjs": [themeFileHash(Buffer.from(retiredRuntime))] },
};

const hidden = async (systems: string) => (await readdir(systems)).filter((name) => name.startsWith("."));

/** A real refresh whose numbered directory renames fail, as a folder held open by another process does on Windows. */
function lockedRefresh(...failing: number[]): BundledThemeRefresh {
  let calls = 0;
  return (id, source, destination, writeFonts) => refreshBundledTheme(id, source, destination, writeFonts, async (from, to) => {
    calls += 1;
    if (failing.includes(calls)) throw Object.assign(new Error("locked"), { code: "EPERM" });
    await rename(from, to);
  });
}

describe("bundled theme refresh on upgrade", () => {
  test("Given every bundled theme When hashing its shipped files Then the history records it so the next release can upgrade it", async () => {
    for (const { slug } of bundledDesignSystems) {
      const files = await readThemeFiles(path.join(resolveRepoRoot(), "design system themes", slug));
      expect(files).not.toBeNull();
      expect(bundledThemeHistory.themes[slug]).toContain(themeTreeDigest(files!));
    }
  }, 30_000);

  test("Given an untouched copy from an older release When startup seeds themes Then it takes the installed bundle and keeps user font files", async () => {
    const { systems, installed } = await upgradedProfile({
      ...legacyTheme,
      "liquid-glass/liquid-glass.mjs": retiredRuntime,
      "fonts/fonts.css": "/* stale stylesheet */\n",
      "fonts/Brand.woff2": "brand font bytes",
    });

    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory);

    const refreshed = await readThemeFiles(installed);
    const shipped = await readThemeFiles(source);
    expect(themeTreeDigest(refreshed!)).toBe(themeTreeDigest(shipped!));
    expect(existsSync(path.join(installed, "liquid-glass"))).toBe(false);
    expect(await readFile(path.join(installed, "fonts", "Brand.woff2"), "utf8")).toBe("brand font bytes");
    expect(await readFile(path.join(installed, "fonts", "fonts.css"), "utf8")).not.toBe("/* stale stylesheet */\n");
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given a copy the user edited When startup seeds themes Then every byte stays as the user left it", async () => {
    const edited = { ...legacyTheme, "colors_and_type.css": ":root { --gray-90: #123456; }\n", "liquid-glass/liquid-glass.mjs": retiredRuntime };
    const { systems, installed } = await upgradedProfile(edited);
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory);

    expect(await readThemeFiles(installed)).toEqual(before);
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given an older copy whose retired runtime was changed When startup seeds themes Then the copy is kept", async () => {
    const { systems, installed } = await upgradedProfile({ ...legacyTheme, "liquid-glass/liquid-glass.mjs": "export const glass = false;\n" });
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory);

    expect(await readThemeFiles(installed)).toEqual(before);
  });

  test("Given a folder another process holds open When the upgrade swap fails Then startup continues with the old copy unchanged and no stage left", async () => {
    const { systems, installed } = await upgradedProfile({ ...legacyTheme, "fonts/Brand.woff2": "brand font bytes" });
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory, lockedRefresh(2));

    expect(await readThemeFiles(installed)).toEqual(before);
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given the old folder cannot be put back either When the upgrade swap fails Then startup continues and the only copy is kept for recovery", async () => {
    const { systems, installed } = await upgradedProfile(legacyTheme);
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory, lockedRefresh(2, 3));
    const kept = await hidden(systems);

    expect(existsSync(installed)).toBe(false);
    expect(kept).toHaveLength(1);
    expect(await readThemeFiles(path.join(systems, kept[0]!))).toEqual(before);
  });

  test("Given a theme already upgraded When startup seeds themes again Then nothing is rewritten", async () => {
    const { systems, installed } = await upgradedProfile(legacyTheme);
    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory);
    const upgraded = await readThemeFiles(installed);
    let refreshes = 0;

    await seedBundledDesignSystems(resolveRepoRoot(), systems, { ...legacyHistory, themes: { [SLUG]: [...legacyHistory.themes[SLUG]!, themeTreeDigest(upgraded!)] } }, async () => { refreshes += 1; });

    expect(refreshes).toBe(0);
    expect(await readThemeFiles(installed)).toEqual(upgraded);
  });

  test("Given a copy saved with Windows line endings When startup seeds themes Then it is still recognised as untouched", async () => {
    const crlf = Object.fromEntries(Object.entries(legacyTheme).map(([file, text]) => [file, text.replaceAll("\n", "\r\n")]));
    const { systems, installed } = await upgradedProfile(crlf);

    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory);

    expect(themeTreeDigest((await readThemeFiles(installed))!)).toBe(themeTreeDigest((await readThemeFiles(source))!));
  });
});
