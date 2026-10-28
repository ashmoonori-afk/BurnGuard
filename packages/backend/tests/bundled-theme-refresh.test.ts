import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { seedBundledDesignSystems } from "../src/bootstrap";
import { bundledDesignSystemId, bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot, systemsDir } from "../src/lib/paths";
import { getSqlite } from "../src/db/sqlite-client";
import { ensureProjectDesignSystemPin, inspectProjectDesignSystemPin } from "../src/services/project-design-system-pin";
import { reconcileExtractionPublications } from "../src/services/extraction-publication";
import {
  bundledThemeHistory, readThemeFiles, recoverBundledTheme, refreshBundledTheme, themeAdditiveDigest, themeFileHash, themeTreeDigest, type BundledThemeHistory, type BundledThemeRefresh,
} from "../src/services/bundled-theme-refresh";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const SLUG = "light";
const source = path.join(resolveRepoRoot(), "design system themes", SLUG);
const legacyTheme = {
  "README.md": "# Light\nOlder palette notes.\n",
  "SKILL.md": "# Light\nUse the older palette.\n",
  "colors_and_type.css": ":root { --gray-90: #09090B; }\n",
  "surfaces/website.css": ":root { --web-body: 16px; }\n",
  "assets/logo.svg": "<svg></svg>\n",
  "fonts/fonts.css": "/* historical fonts */\n",
  "fonts/fonts.md": "# Historical fonts\n",
};
const retiredRuntime = "export const glass = true;\n";

/** Profile from an older release: every other theme is already current or edited, so only `light` can change. */
async function upgradedProfile(files: Readonly<Record<string, string>>) {
  await mkdir(systemsDir, { recursive: true });
  const root = await mkdtemp(path.join(systemsDir, ".bg-theme-refresh-"));
  roots.push(root);
  const systems = path.join(root, "systems");
  const repoRoot = path.join(root, "bundle");
  const shipped = path.join(repoRoot, "design system themes", SLUG);
  await cp(source, shipped, { recursive: true });
  for (const directory of ["palette", "canonical"]) {
    await mkdir(path.join(shipped, directory), { recursive: true });
    await writeFile(path.join(shipped, directory, "SKILL.md"), "# Additive instructions\n");
  }
  await Promise.all(bundledDesignSystems.filter(({ slug }) => slug !== SLUG).map(({ slug }) => mkdir(path.join(systems, bundledDesignSystemId(slug)), { recursive: true })));
  const installed = path.join(systems, bundledDesignSystemId(SLUG));
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(installed, relative)), { recursive: true });
    await writeFile(path.join(installed, relative), text);
  }
  return { systems, installed, repoRoot, shipped };
}

const legacyHistory: BundledThemeHistory = {
  themes: { [SLUG]: [themeTreeDigest(new Map(Object.entries(legacyTheme).map(([file, text]) => [file, themeFileHash(Buffer.from(text))])))] },
  retired: { "liquid-glass/liquid-glass.mjs": [themeFileHash(Buffer.from(retiredRuntime))] },
};

const hidden = async (systems: string) => (await readdir(systems)).filter((name) => name.startsWith("."));

/** A real refresh whose numbered directory renames fail, as a folder held open by another process does on Windows. */
function lockedRefresh(...failing: number[]): BundledThemeRefresh {
  let calls = 0;
  return (id, source, destination, history) => refreshBundledTheme(id, source, destination, history, async (from, to) => {
    calls += 1;
    if (failing.includes(calls)) throw Object.assign(new Error("locked"), { code: "EPERM" });
    await rename(from, to);
  });
}

describe("bundled theme refresh on upgrade", () => {
  test("Given historical legacy bytes When the bundle has no additions Then startup preserves the installed tree", async () => {
    const { systems, installed } = await upgradedProfile(legacyTheme);
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(resolveRepoRoot(), systems, legacyHistory);

    expect(await readThemeFiles(installed)).toEqual(before);
  });

  test.each(["palette", "canonical"].flatMap(directory =>
    ["file", "empty", "edited", "extra", "case"].map(kind => ({ directory, kind }))))(
    "Given a reserved $directory collision of $kind When seeding Then its content survives",
    async ({ directory, kind }) => {
      const name = kind === "case" ? directory.toUpperCase() : directory;
      const files = kind === "file" ? { [name]: "user file" } : kind === "empty" ? {} :
        { [`${name}/SKILL.md`]: "# User instructions\n", ...(kind === "extra" ? { [`${name}/extra.json`]: "{}" } : {}) };
      const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, ...files });
      if (kind === "empty") await mkdir(path.join(installed, name));
      const before = await readThemeFiles(installed);
      if (before === null) throw new Error("Unsafe fixture");
      await seedBundledDesignSystems(repoRoot, systems, legacyHistory);
      const after = await readThemeFiles(installed);
      for (const [file, hash] of before) expect(after?.get(file)).toBe(hash);
      if (kind !== "file") expect((await readdir(path.join(installed, name))).sort()).toEqual(
        Object.keys(files).map(file => path.basename(file)).sort());
    },
  );

  test("Given recognized older additions When seeding Then only those subtrees are replaced", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, "palette/old.json": "{}", "canonical/old.json": "{}" });
    const old = await readThemeFiles(installed);
    if (old === null) throw new Error("Unsafe fixture");
    const history: BundledThemeHistory = { ...legacyHistory, additive: { [SLUG]: {
      palette: [themeAdditiveDigest(old, "palette")], canonical: [themeAdditiveDigest(old, "canonical")],
    } } };
    await mkdir(path.join(installed, "palette/user-empty"));
    await seedBundledDesignSystems(repoRoot, systems, history);
    expect((await readdir(path.join(installed, "palette"))).sort()).toEqual(["SKILL.md", "user-empty"]);
    expect(await readdir(path.join(installed, "palette/user-empty"))).toEqual([]);
    expect(await readdir(path.join(installed, "canonical"))).toEqual(["SKILL.md"]);
    expect(themeTreeDigest((await readThemeFiles(installed)) ?? new Map())).toBe(themeTreeDigest(old));
  });

  test.each([false, true])("Given a historical project with pinned=%s When additions arrive Then pin context and artifact bytes stay unchanged", async (pinned) => {
    const { systems, installed, repoRoot } = await upgradedProfile(legacyTheme);
    const db = getSqlite(), id = crypto.randomUUID(), systemId = bundledDesignSystemId(SLUG);
    const projectDir = path.join(path.dirname(systems), "project");
    await mkdir(projectDir);
    const artifact = Buffer.from('<link rel="stylesheet" href="legacy.css"><p>Saved artwork</p>');
    await writeFile(path.join(projectDir, "index.html"), artifact);
    await writeFile(path.join(projectDir, "legacy.css"), legacyTheme["colors_and_type.css"]);
    db.prepare("INSERT INTO design_systems(id,name,status,source_type,is_template,dir_path,skill_md_path,tokens_css_path,readme_md_path,created_at,updated_at) VALUES (?,?,'published','sample',0,?,?,?,?,1,1)")
      .run(systemId, "Light", installed, ...["SKILL.md", "colors_and_type.css", "README.md"].map(file => path.join(installed, file)));
    db.prepare("INSERT INTO projects(id,name,type,design_system_id,dir_path,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,?,'codex',1,1)").run(id, "Historical", systemId, projectDir);
    try {
      const baseline = await ensureProjectDesignSystemPin(id);
      if (!pinned) db.prepare("DELETE FROM project_design_system_pins WHERE project_id=?").run(id);
      await seedBundledDesignSystems(repoRoot, systems, legacyHistory);
      expect(await ensureProjectDesignSystemPin(id)).toEqual(baseline);
      expect((await inspectProjectDesignSystemPin(id))?.candidate_digest).toBe(baseline?.digest);
      expect(await readFile(path.join(projectDir, "index.html"))).toEqual(artifact);
      expect(await readFile(path.join(projectDir, "legacy.css"), "utf8")).toBe(legacyTheme["colors_and_type.css"]);
    } finally {
      db.prepare("DELETE FROM projects WHERE id=?").run(id);
      db.prepare("DELETE FROM design_systems WHERE id=?").run(systemId);
    }
  });

  test("Given every bundled theme When hashing its shipped files Then the history records it so the next release can upgrade it", async () => {
    for (const { slug } of bundledDesignSystems) {
      const files = await readThemeFiles(path.join(resolveRepoRoot(), "design system themes", slug));
      expect(files).not.toBeNull();
      expect(bundledThemeHistory.themes[slug]).toContain(themeTreeDigest(files!));
    }
  }, 30_000);

  test("Given an untouched older release When startup seeds themes Then additions arrive without changing legacy bytes", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile({
      ...legacyTheme,
      "liquid-glass/liquid-glass.mjs": retiredRuntime,
      "fonts/fonts.css": "/* stale stylesheet */\n",
      "fonts/Brand.woff2": "brand font bytes",
    });

    const bytes = await Promise.all(Object.keys(legacyTheme).map(file => readFile(path.join(installed, file))));
    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);

    const refreshed = await readThemeFiles(installed);
    expect(themeTreeDigest(refreshed!)).toBe(legacyHistory.themes[SLUG]?.[0]);
    expect(await Promise.all(Object.keys(legacyTheme).map(file => readFile(path.join(installed, file))))).toEqual(bytes);
    expect(await readFile(path.join(installed, "liquid-glass/liquid-glass.mjs"), "utf8")).toBe(retiredRuntime);
    expect(await readFile(path.join(installed, "fonts", "Brand.woff2"), "utf8")).toBe("brand font bytes");
    expect(await readFile(path.join(installed, "fonts", "fonts.css"), "utf8")).toBe("/* stale stylesheet */\n");
    expect(existsSync(path.join(installed, "palette/SKILL.md"))).toBe(true);
    expect(await hidden(systems)).toEqual([]);
  });

  test.each(["colors_and_type.css", "README.md", "unknown.json"])("Given a copy edited at %s When startup seeds themes Then every byte stays as the user left it", async (file) => {
    const edited = { ...legacyTheme, [file]: "User edit\n", "liquid-glass/liquid-glass.mjs": retiredRuntime };
    const { systems, installed, repoRoot } = await upgradedProfile(edited);
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);

    expect(await readThemeFiles(installed)).toEqual(before);
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given an older copy whose retired runtime was changed When startup seeds themes Then the copy is kept", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, "liquid-glass/liquid-glass.mjs": "export const glass = false;\n" });
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);

    expect(await readThemeFiles(installed)).toEqual(before);
  });

  test("Given a folder another process holds open When the upgrade swap fails Then startup continues with the old copy unchanged and no stage left", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, "fonts/Brand.woff2": "brand font bytes" });
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory, lockedRefresh(2));

    expect(await readThemeFiles(installed)).toEqual(before);
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given the old folder cannot be put back either When the upgrade swap fails Then startup continues and the only copy is kept for recovery", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile(legacyTheme);
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory, lockedRefresh(2, 3));
    const kept = await hidden(systems);

    expect(existsSync(installed)).toBe(false);
    expect(kept).toHaveLength(1);
    expect(await readThemeFiles(path.join(systems, kept[0]!))).toEqual(before);
  });

  test("Given a theme already upgraded When startup seeds themes again Then nothing is rewritten", async () => {
    const { systems, installed, repoRoot, shipped } = await upgradedProfile(legacyTheme);
    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);
    const upgraded = await readThemeFiles(installed);
    let refreshes = 0;

    await refreshBundledTheme(bundledDesignSystemId(SLUG), shipped, installed, legacyHistory, async (from, to) => { refreshes += 1; await rename(from, to); });

    expect(refreshes).toBe(0);
    expect(await readThemeFiles(installed)).toEqual(upgraded);
  });

  test("Given publication and rollback were interrupted When cleanup and the next startup run Then user fonts survive", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, "fonts/Brand.woff2": "brand font bytes" });
    await seedBundledDesignSystems(repoRoot, systems, legacyHistory, lockedRefresh(2, 3));
    expect(existsSync(installed)).toBe(false);

    await reconcileExtractionPublications(systems);
    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);

    expect(await readFile(path.join(installed, "fonts", "Brand.woff2"), "utf8")).toBe("brand font bytes");
    expect(await hidden(systems)).toEqual([]);
  });

  test.each(["prepared", "backed-up", "published"])("Given an upgrade interrupted at %s When startup runs Then user fonts survive and leftover copies are removed", async (boundary) => {
    const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, "fonts/Brand.woff2": "brand font bytes" });
    const previous = path.join(systems, `.${bundledDesignSystemId(SLUG)}.previous`);
    const stage = path.join(systems, `.${bundledDesignSystemId(SLUG)}.staging-${crypto.randomUUID()}`);
    await cp(installed, stage, { recursive: true });
    await mkdir(path.join(stage, "palette"), { recursive: true });
    await writeFile(path.join(stage, "palette/SKILL.md"), "# Additive instructions\n");
    if (boundary !== "prepared") await rename(installed, previous);
    if (boundary === "published") await rename(stage, installed);

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);
    await reconcileExtractionPublications(systems);

    expect(await readFile(path.join(installed, "fonts", "Brand.woff2"), "utf8")).toBe("brand font bytes");
    expect(await readFile(path.join(installed, "colors_and_type.css"), "utf8")).toBe(legacyTheme["colors_and_type.css"]);
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given recovery is blocked by a locked directory When cleanup runs Then the previous copy survives for a later startup", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, "fonts/Brand.woff2": "brand font bytes" });
    const previous = path.join(systems, `.${bundledDesignSystemId(SLUG)}.previous`);
    await rename(installed, previous);
    const before = await readThemeFiles(previous);
    const locked = Object.assign(new Error("locked"), { code: "EPERM" });

    await expect(recoverBundledTheme(installed, async () => { throw locked; })).rejects.toBe(locked);
    await reconcileExtractionPublications(systems);

    expect(existsSync(installed)).toBe(false);
    expect(await readThemeFiles(previous)).toEqual(before);
    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);
    expect(await readFile(path.join(installed, "fonts", "Brand.woff2"), "utf8")).toBe("brand font bytes");
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given a recovered theme was edited When startup runs Then its bytes are preserved instead of replaced", async () => {
    const { systems, installed, repoRoot } = await upgradedProfile({ ...legacyTheme, "colors_and_type.css": ":root { --gray-90: #123456; }\n", "fonts/Brand.woff2": "brand font bytes" });
    const before = await readThemeFiles(installed);
    await rename(installed, path.join(systems, `.${bundledDesignSystemId(SLUG)}.previous`));

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);

    expect(await readThemeFiles(installed)).toEqual(before);
    expect(await hidden(systems)).toEqual([]);
  });

  test("Given a copy saved with Windows line endings When startup seeds themes Then it is still recognised as untouched", async () => {
    const crlf = Object.fromEntries(Object.entries(legacyTheme).map(([file, text]) => [file, text.replace(/\n/g, "\r\n")]));
    const { systems, installed, repoRoot } = await upgradedProfile(crlf);

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);

    expect(await readFile(path.join(installed, "colors_and_type.css"), "utf8")).toBe(crlf["colors_and_type.css"] ?? "");
    expect(existsSync(path.join(installed, "palette/SKILL.md"))).toBe(true);
  });
});
