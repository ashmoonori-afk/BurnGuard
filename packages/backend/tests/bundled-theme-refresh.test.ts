import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fsp from "node:fs/promises";
import { cp, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseHexColor } from "@bg/shared/color";
import { createDefaultPalette, emitPaletteCss, serializePalette } from "@bg/shared/palette";
import { createDefaultThemeSettings, synthesizeTheme } from "@bg/shared/theme";
import { seedBundledDesignSystems as seedBundled } from "../src/bootstrap";
import { bundledDesignSystemId, bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot, systemsDir } from "../src/lib/paths";
import { getSqlite } from "../src/db/sqlite-client";
import { ensureProjectDesignSystemPin, inspectProjectDesignSystemPin } from "../src/services/project-design-system-pin";
import { reconcileExtractionPublications } from "../src/services/extraction-publication";
import { recoverSystemContent } from "../src/services/system-content-publication";
import { getCurrentSystemContent } from "../src/db/catalog-repository";
import { validateCatalogReceiptTree } from "../src/services/catalog-files";
import { parseContentJournal } from "../src/services/system-content-format";
import { DEFAULT_CANONICAL_TREE_LIMITS } from "../src/services/canonical-tree-manifest";
import { writeCanonicalCandidate } from "../src/services/canonical-theme-files";
import {
  bundledAdditionValidator, bundledThemeHistory, readThemeFiles, recoverBundledTheme, refreshBundledTheme, themeAdditiveDigest, themeFileHash, themeTreeDigest, type BundledThemeHistory, type BundledThemeRefresh,
} from "../src/services/bundled-theme-refresh";

const roots: string[] = [];
const ownedIds: string[] = [];
afterEach(async () => {
  for (const id of ownedIds.splice(0)) {
    getSqlite().query("DELETE FROM design_system_receipts WHERE design_system_id=?").run(id);
    getSqlite().query("DELETE FROM design_systems WHERE id=?").run(id);
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// The fixture's shipped hashes are trusted build data, in the same existing history format.
async function fixtureHistory(repo: string, history: BundledThemeHistory): Promise<BundledThemeHistory> {
  const files = await readThemeFiles(path.join(repo, "design system themes", SLUG));
  if (files === null) throw new Error("Unsafe shipped fixture");
  const additive = Object.fromEntries(["palette", "canonical"].map(directory => {
    const name = directory === "palette" ? "palette" : "canonical";
    return [name, [...(history.additive?.[SLUG]?.[name] ?? []), themeAdditiveDigest(files, name)]];
  }));
  return { ...history, additive: { ...history.additive, [SLUG]: additive } };
}
async function seedBundledDesignSystems(
  repo: string, systems: string, history: BundledThemeHistory, refresh: BundledThemeRefresh = refreshBundledTheme,
) {
  await seedBundled(repo, systems, await fixtureHistory(repo, history), refresh);
}

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

async function writeSyntheticAdditions(root: string, amount = 0.2): Promise<void> {
  const defaults = createDefaultPalette();
  const palette = { ...defaults, curve: { ...defaults.curve, amount } };
  await mkdir(path.join(root, "palette"), { recursive: true });
  await writeFile(path.join(root, "palette/state.json"), serializePalette(palette));
  await writeFile(path.join(root, "palette/scales.css"), emitPaletteCss(palette));
  await writeCanonicalCandidate(root, synthesizeTheme({
    system_id: bundledDesignSystemId(SLUG), default_mode: "light", palette,
    sources: { brand: { kind: "color", color: parseHexColor("#123456") }, surface: { kind: "scale", id: "neutral" },
      status: { success: parseHexColor("#15803d"), warning: parseHexColor("#a16207"),
        destructive: parseHexColor("#b91c1c"), info: parseHexColor("#0369a1") } },
    settings: { light: createDefaultThemeSettings(), dark: createDefaultThemeSettings() },
  }));
}

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
    // Each synthetic release owns its additive inputs, independently of today's bundle.
    await rm(path.join(shipped, directory), { recursive: true, force: true });
  }
  await writeSyntheticAdditions(shipped);
  await Promise.all(bundledDesignSystems.filter(({ slug }) => slug !== SLUG).map(({ slug }) => mkdir(path.join(systems, bundledDesignSystemId(slug)), { recursive: true })));
  const installed = path.join(systems, bundledDesignSystemId(SLUG));
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(installed, relative)), { recursive: true });
    await writeFile(path.join(installed, relative), text);
  }
  const id = bundledDesignSystemId(SLUG);
  getSqlite().query(`INSERT INTO design_systems(id,name,status,source_type,is_template,dir_path,skill_md_path,tokens_css_path,readme_md_path,created_at,updated_at)
    VALUES (?,?,'published','sample',0,?,?,?,?,1,1)`).run(
    id, "Light", installed, ...["SKILL.md", "colors_and_type.css", "README.md"].map(file => path.join(installed, file)),
  );
  ownedIds.push(id);
  return { systems, installed, repoRoot, shipped };
}

const legacyHistory: BundledThemeHistory = {
  themes: { [SLUG]: [themeTreeDigest(new Map(Object.entries(legacyTheme).map(([file, text]) => [file, themeFileHash(Buffer.from(text))])))] },
  retired: { "liquid-glass/liquid-glass.mjs": [themeFileHash(Buffer.from(retiredRuntime))] },
};

const hidden = async (systems: string) => {
  const names: string[] = [];
  for (const name of await readdir(systems)) {
    if (name === ".catalog-locks") { expect(await readdir(path.join(systems, name))).toEqual([]); continue; }
    if (name === ".system-content") {
      for (const operation of await readdir(path.join(systems, name))) names.push(path.join(name, operation, "previous"));
      continue;
    }
    if (name.startsWith(".")) names.push(name);
  }
  return names;
};

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
  test("Given excluded payload exceeds the whole-copy budget When recognizing a bundle Then no payload is read into memory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-bundle-budget-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const payload = path.join(root, ".git", "oversized");
    const handle = await open(payload, "w");
    try { await handle.truncate(DEFAULT_CANONICAL_TREE_LIMITS.bytes + 1); }
    finally { await handle.close(); }
    let payloadReads = 0;
    const originalRead = fsp.readFile;
    const originalOpen = fsp.open;
    const read = spyOn(fsp, "readFile").mockImplementation((async (...args: Parameters<typeof fsp.readFile>) => {
      if (args[0] === payload) { payloadReads += 1; throw new Error("OVER_BUDGET_PAYLOAD_READ"); }
      return originalRead(...args);
    }) as typeof fsp.readFile);
    const opened = spyOn(fsp, "open").mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      if (args[0] === payload) { payloadReads += 1; throw new Error("OVER_BUDGET_PAYLOAD_READ"); }
      return originalOpen(...args);
    });
    try {
      expect(await readThemeFiles(root)).toBeNull();
      expect(payloadReads).toBe(0);
    } finally { read.mockRestore(); opened.mockRestore(); }
  });

  test.each(["metadata", "held-lock"] as const)(
    "Given a missing live bundle protected by %s When standalone seeding runs Then it is not recreated",
    async protection => {
      const { systems, installed, repoRoot } = await upgradedProfile(legacyTheme);
      const id = bundledDesignSystemId(SLUG);
      const saved = path.join(path.dirname(systems), "preserved-system");
      await rename(installed, saved);
      if (protection === "metadata") {
        getSqlite().query("UPDATE design_systems SET metadata_revision=1,name='User metadata' WHERE id=?").run(id);
      } else await mkdir(path.join(systems, ".catalog-locks", id), { recursive: true });
      const row = getSqlite().query("SELECT * FROM design_systems WHERE id=?").get(id);
      const before = await readThemeFiles(saved);

      await seedBundled(repoRoot, systems, legacyHistory, refreshBundledTheme, "create-missing");

      expect(existsSync(installed)).toBe(false);
      expect(await readThemeFiles(saved)).toEqual(before);
      expect(getSqlite().query("SELECT * FROM design_systems WHERE id=?").get(id)).toEqual(row);
      if (protection === "held-lock") expect(existsSync(path.join(systems, ".catalog-locks", id))).toBe(true);
    },
  );

  test("Given a receipt-owned bundle When recognized additions advance Then a real next receipt preserves every legacy byte", async () => {
    const { systems, installed, repoRoot, shipped } = await upgradedProfile(legacyTheme);
    await mkdir(path.join(installed, "fonts/user-empty"));
    const legacyBytes = await Promise.all(Object.keys(legacyTheme).map(file => readFile(path.join(installed, file))));
    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);
    const first = getCurrentSystemContent(getSqlite(), bundledDesignSystemId(SLUG));
    if (first === null) throw new Error("Missing first content authority");
    const firstFiles = await readThemeFiles(installed);
    if (firstFiles === null) throw new Error("Unsafe fixture");
    await writeSyntheticAdditions(shipped, 0.15);
    const history: BundledThemeHistory = { ...legacyHistory, additive: { [SLUG]: {
      palette: [themeAdditiveDigest(firstFiles, "palette")],
      canonical: [themeAdditiveDigest(firstFiles, "canonical")],
    } } };

    await seedBundledDesignSystems(repoRoot, systems, history);

    const next = getCurrentSystemContent(getSqlite(), bundledDesignSystemId(SLUG));
    if (next === null) throw new Error("Missing next content authority");
    expect(next).toMatchObject({ schemaVersion: 2, status: "committed", contentRevision: 2, parentReceiptId: first.id, parentDigest: first.digest });
    expect(next.id).not.toBe(first.id);
    expect(JSON.parse(next.provenanceJson)).toMatchObject({ writer: "bundled-addition", source_extraction: null });
    expect(parseContentJournal(JSON.parse(next.metadataJson))).toMatchObject({
      write_set: ["canonical/theme.json", "palette/scales.css", "palette/state.json"],
      palette_history: null, cleanup: "complete",
    });
    await expect(bundledAdditionValidator(await fixtureHistory(repoRoot, history))(installed, {
      ...parseContentJournal(JSON.parse(next.metadataJson)), write_set: ["README.md"],
    })).rejects.toMatchObject({ code: "system_content_corrupt" });
    await validateCatalogReceiptTree(installed, next);
    expect(await Promise.all(Object.keys(legacyTheme).map(file => readFile(path.join(installed, file))))).toEqual(legacyBytes);
    expect(await readdir(path.join(installed, "fonts/user-empty"))).toEqual([]);
  });

  test("Given unrecognized shipped additions When refresh runs Then no receipt or files are manufactured", async () => {
    const { installed, shipped } = await upgradedProfile(legacyTheme);
    const before = await readThemeFiles(installed);
    await refreshBundledTheme(bundledDesignSystemId(SLUG), shipped, installed, legacyHistory);
    expect(await readThemeFiles(installed)).toEqual(before);
    expect(getCurrentSystemContent(getSqlite(), bundledDesignSystemId(SLUG))).toBeNull();
  });
  test("Given historical legacy bytes When the bundle has no additions Then startup preserves the installed tree", async () => {
    const { systems, installed, repoRoot, shipped } = await upgradedProfile(legacyTheme);
    for (const directory of ["palette", "canonical"]) {
      await rm(path.join(shipped, directory), { recursive: true, force: true });
    }
    const before = await readThemeFiles(installed);

    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);

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
    expect((await readdir(path.join(installed, "palette"))).sort()).toEqual(["scales.css", "state.json", "user-empty"]);
    expect(await readdir(path.join(installed, "palette/user-empty"))).toEqual([]);
    expect((await readdir(path.join(installed, "canonical"))).sort()).toEqual(["SKILL.md", "theme.css", "theme.json"]);
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
    expect(existsSync(path.join(installed, "palette/state.json"))).toBe(true);
    expect(existsSync(path.join(installed, "palette/scales.css"))).toBe(true);
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
    // A standalone seed pass must not turn the publisher's missing live path into a fresh install.
    await seedBundledDesignSystems(repoRoot, systems, legacyHistory);
    expect(existsSync(installed)).toBe(false);
    expect(await hidden(systems)).toEqual(kept);
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
    await recoverSystemContent({
      db: getSqlite(), systemsRoot: systems, operationId: crypto.randomUUID, now: () => 2,
      validators: { "bundled-addition": bundledAdditionValidator(await fixtureHistory(repoRoot, legacyHistory)) },
    });
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
    expect(existsSync(path.join(installed, "palette/state.json"))).toBe(true);
    expect(existsSync(path.join(installed, "palette/scales.css"))).toBe(true);
  });
});
