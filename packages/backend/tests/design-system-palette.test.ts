import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDefaultPalette, emitPaletteCss, PALETTE_EMITTER_VERSION, parseSaveDesignSystemPaletteRequest,
  serializePalette, type PaletteState,
} from "@bg/shared/palette";
import { parseHexColor, parseRgb } from "@bg/shared/color";
import { getCurrentSystemContent, getCatalogRow } from "../src/db/catalog-repository";
import { listSystemContentReceipts } from "../src/db/design-system-repository";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { copyCatalogSystem } from "../src/services/catalog-lifecycle";
import { validateCatalogReceiptTree } from "../src/services/catalog-files";
import {
  paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette, validatePaletteContent,
} from "../src/services/design-system-palette";
import { buildExtractionProvenance } from "../src/services/extraction-provenance";
import { contentHash, parseContentJournal } from "../src/services/system-content-format";
import { observeSystemContent, publishSystemContent } from "../src/services/system-content-publication";
import { withSystemContentAccess } from "../src/services/system-content-access";
import { inspectContentTree } from "../src/services/system-content-tree";
import { createApp, classifyApiRoute } from "../src/server";
import { BURNGUARD_CAPABILITY_HEADER } from "../src/security/request-authority";
import { expectedDigest, fixture, rulesAdapter, validateRules } from "./fixtures/system-content-fixture";
import brandAnchors from "./fixtures/theme-engine/baseline/brand-anchors.json";

const roots: string[] = [];
const databases: Database[] = [];
const routeIds: string[] = [];
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "bg-palette-"));
  roots.push(root);
  const f = await fixture(root, "replace");
  databases.push(f.db);
  return { ...f, env: paletteContentEnvironment(f.db, f.systemsRoot) };
}
afterEach(async () => {
  for (const db of databases.splice(0)) db.close(true);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  for (const id of routeIds.splice(0)) {
    getSqlite().query("DELETE FROM design_systems WHERE id=?").run(id);
    await rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
});
const state = createDefaultPalette();
async function save(f: Awaited<ReturnType<typeof setup>>, next: PaletteState = state) {
  const current = await readDesignSystemPalette("test-system", f.env);
  return saveDesignSystemPalette("test-system", { expected_digest: current.expected_digest, state: next }, f.env);
}
async function installUnownedPair(f: Awaited<ReturnType<typeof setup>>) {
  await mkdir(path.join(f.live, "palette"));
  await writeFile(path.join(f.live, "palette/state.json"), serializePalette(state));
  await writeFile(path.join(f.live, "palette/scales.css"), emitPaletteCss(state));
}
function requiredReceipt(f: Awaited<ReturnType<typeof setup>>) {
  const receipt = getCurrentSystemContent(f.db, "test-system");
  if (receipt === null) throw new Error("Missing fixture receipt");
  return receipt;
}
describe("design system palette persistence", () => {
  test("Given an absent pair When GET observes the installed tree Then no default state or receipt is invented", async () => {
    const f = await setup();
    const result = await readDesignSystemPalette("test-system", f.env);
    expect(result).toMatchObject({ state: null, css: null, content_revision: 0, receipt_id: null });
    expect(result.expected_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await readdir(f.live)).not.toContain("palette");
  });
  test.each(["srgb", "display-p3"] as const)("Given %s state When saved and reopened Then exact disk bytes and one history survive", async gamut => {
    const f = await setup();
    const anchor = brandAnchors.rows[0];
    if (anchor === undefined) throw new Error("Missing frozen anchor");
    const next: PaletteState = { ...state, gamut, anchors: [{ id: anchor.id, name: anchor.name, color: parseHexColor(anchor.hex) }] };
    const result = await save(f, next);
    const json = await readFile(path.join(f.live, "palette/state.json"), "utf8");
    const css = await readFile(path.join(f.live, "palette/scales.css"), "utf8");
    expect(json).toBe(serializePalette(next));
    expect(css).toBe(emitPaletteCss(next));
    expect(result.state).toEqual(next);
    expect(result.css).toBe(css);
    expect(result.content_revision).toBe(1);
    const receipt = requiredReceipt(f);
    await validateCatalogReceiptTree(f.live, receipt);
    const history = parseContentJournal(JSON.parse(receipt.metadataJson)).palette_history;
    expect(history).toEqual({ emitter_version: PALETTE_EMITTER_VERSION, before: { present: false },
      after: { present: true, json: { bytes: json, length: Buffer.byteLength(json), sha256: contentHash(json) },
        css: { bytes: css, length: Buffer.byteLength(css), sha256: contentHash(css) } } });
    const reopened = new Database(f.dbPath);
    databases.push(reopened);
    expect(await readDesignSystemPalette("test-system", paletteContentEnvironment(reopened, f.systemsRoot))).toEqual(result);
    expect(listSystemContentReceipts(f.db)).toHaveLength(1);
  });
  test.each([
    { name: "compact", suffix: "", accepted: true },
    { name: "LF", suffix: "\n", accepted: true },
    { name: "CRLF", suffix: "\r\n", accepted: false },
    { name: "double-LF", suffix: "\n\n", accepted: false },
    { name: "space", suffix: " ", accepted: false },
  ])("Given $name JSON When validating a candidate Then only an optional terminal LF is accepted", async ({ suffix, accepted }) => {
    const f = await setup();
    await save(f);
    const journal = parseContentJournal(JSON.parse(requiredReceipt(f).metadataJson));
    const history = journal.palette_history;
    if (history === null || !history.after.present) throw new Error("Missing fixture palette history");
    const bytes = serializePalette(state) + suffix;
    await writeFile(path.join(f.live, "palette/state.json"), bytes);
    const candidate = {
      ...journal,
      palette_history: {
        ...history,
        after: {
          ...history.after,
          json: { bytes, length: Buffer.byteLength(bytes), sha256: contentHash(bytes) },
        },
      },
    };
    if (accepted) await expect(validatePaletteContent(f.live, candidate)).resolves.toBeUndefined();
    else await expect(validatePaletteContent(f.live, candidate)).rejects.toMatchObject({ code: "system_content_corrupt" });
    // Text acceptance cannot authorize a changed file against an existing receipt.
    if (suffix !== "") {
      await expect(readDesignSystemPalette("test-system", f.env)).rejects.toMatchObject({ code: "system_content_conflict" });
    }
  });
  test("Given installed unrelated bytes When saved Then canonical excluded CRLF and empty directories survive", async () => {
    const f = await setup();
    const before = await inspectContentTree(f.live);
    await save(f);
    const after = await inspectContentTree(f.live);
    expect(after.inventory.filter(entry => !entry[1].startsWith("palette"))).toEqual([...before.inventory]);
  });
  test("Given an existing project pin When palette content advances Then pinned bytes digest and revision remain unchanged", async () => {
    const f = await setup();
    f.db.query(`INSERT INTO projects(id,name,type,design_system_id,dir_path,backend_id,created_at,updated_at)
      VALUES ('pinned-project','Pinned','prototype','test-system',?,'codex',1,1)`).run(path.join(f.systemsRoot, "project"));
    const context = "pinned context\r\n", tokens = "--legacy: #123456;\r\n";
    f.db.query(`INSERT INTO project_design_system_pins(project_id,system_id,revision,digest,context,tokens)
      VALUES ('pinned-project','test-system',7,?,?,?)`).run(contentHash(JSON.stringify([context, tokens])), context, tokens);
    const before = f.db.query("SELECT * FROM project_design_system_pins").all();
    await save(f);
    expect(f.db.query("SELECT * FROM project_design_system_pins").all()).toEqual(before);
  });
  test("Given a current digest and identical pair When saved Then no history or authority advances", async () => {
    const f = await setup();
    const first = await save(f);
    const second = await saveDesignSystemPalette("test-system", { expected_digest: first.expected_digest, state }, f.env);
    expect(second).toEqual(first);
    expect(listSystemContentReceipts(f.db)).toHaveLength(1);
  });
  test("Given concurrent saves from one digest When the shared lease serializes them Then only one receipt commits", async () => {
    const f = await setup();
    const current = await readDesignSystemPalette("test-system", f.env);
    const results = await Promise.allSettled([1, 2].map(() =>
      saveDesignSystemPalette("test-system", { expected_digest: current.expected_digest, state }, f.env)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "expected_digest_conflict" });
    expect(listSystemContentReceipts(f.db)).toHaveLength(1);
  });
  test("Given a receipt owned system with excluded edits When saving an old token Then preservation identity rejects it", async () => {
    const f = await setup();
    const current = await save(f);
    await writeFile(path.join(f.live, ".git/payload"), "external");
    await expect(saveDesignSystemPalette("test-system", { expected_digest: current.expected_digest, state }, f.env))
      .rejects.toMatchObject({ code: "expected_digest_conflict" });
    expect(await readFile(path.join(f.live, ".git/payload"), "utf8")).toBe("external");
    expect(listSystemContentReceipts(f.db)).toHaveLength(1);
  });
  test("Given only display changes When saved Then the exact write set contains JSON alone", async () => {
    const f = await setup();
    await save(f);
    await save(f, { ...state, display: { ...state.display, appearance: "dark" } });
    expect(parseContentJournal(JSON.parse(requiredReceipt(f).metadataJson)).write_set).toEqual(["palette/state.json"]);
  });
  test("Given the observed tree When GET calculates its token Then the fixed order digest binds raw pair and authority", async () => {
    const f = await setup();
    await save(f);
    const result = await readDesignSystemPalette("test-system", f.env);
    await withSystemContentAccess(f.db, f.systemsRoot, ["test-system"], async lease => {
      const base = await observeSystemContent(f.env, "test-system", lease);
      const json = await readFile(path.join(f.live, "palette/state.json"));
      const css = await readFile(path.join(f.live, "palette/scales.css"));
      expect(result.expected_digest).toBe(contentHash(JSON.stringify(["system-palette-save-v1", "test-system",
        base.row?.metadataRevision, base.row?.lifecycle, base.recordPaths, base.head, base.tree?.manifest.tree_digest,
        base.tree?.preservation_digest, ["palette/state.json", "present", json.length, contentHash(json)],
        ["palette/scales.css", "present", css.length, contentHash(css)]])));
    });
  });
  test.each(["README.md", ".git/payload", "metadata", "paths"] as const)("Given stale %s identity When saving Then precondition fails before prepare", async kind => {
    const f = await setup();
    const original = await readDesignSystemPalette("test-system", f.env);
    if (kind === "metadata") f.db.query("UPDATE design_systems SET metadata_revision=metadata_revision+1").run();
    else if (kind === "paths") f.db.query("UPDATE design_systems SET readme_md_path=?").run(path.join(f.live, "README.md"));
    else await writeFile(path.join(f.live, kind), "changed\r\n");
    await expect(saveDesignSystemPalette("test-system", { expected_digest: original.expected_digest, state }, f.env))
      .rejects.toMatchObject({ code: "expected_digest_conflict" });
    expect(listSystemContentReceipts(f.db)).toHaveLength(0);
  });
  test("Given a newer head with the same desired state When using an old digest Then ABA still fails", async () => {
    const f = await setup();
    const first = await save(f);
    await save(f, { ...state, display: { ...state.display, appearance: "dark" } });
    const third = await save(f);
    expect(third.state).toEqual(first.state);
    await expect(saveDesignSystemPalette("test-system", { expected_digest: first.expected_digest, state }, f.env))
      .rejects.toMatchObject({ code: "expected_digest_conflict" });
    expect(listSystemContentReceipts(f.db)).toHaveLength(3);
  });
  test.each(["palette/state.json", "palette/scales.css", "README.md"] as const)("Given receipt owned %s drift When saved Then external bytes are preserved", async file => {
    const f = await setup();
    const saved = await save(f);
    await writeFile(path.join(f.live, file), "external bytes");
    await expect(saveDesignSystemPalette("test-system", { expected_digest: saved.expected_digest, state }, f.env))
      .rejects.toMatchObject({ code: "system_content_conflict" });
    expect(await readFile(path.join(f.live, file), "utf8")).toBe("external bytes");
    expect(listSystemContentReceipts(f.db)).toHaveLength(1);
  });
  test.each(["empty", "generated", "one-member", "extra", "case", "invalid-json", "mismatched-css"] as const)(
    "Given an unowned %s reserved directory When read or saved Then no contents are adopted", async kind => {
      const f = await setup();
      const absent = await readDesignSystemPalette("test-system", f.env);
      if (kind === "empty") await mkdir(path.join(f.live, "palette"));
      else if (kind === "case") await mkdir(path.join(f.live, "Palette"));
      else {
        await installUnownedPair(f);
        if (kind === "one-member") await rm(path.join(f.live, "palette/state.json"));
        if (kind === "extra") await writeFile(path.join(f.live, "palette/user.txt"), "preserve");
        if (kind === "invalid-json") await writeFile(path.join(f.live, "palette/state.json"), "{");
        if (kind === "mismatched-css") await writeFile(path.join(f.live, "palette/scales.css"), "bad css");
      }
      const before = await inspectContentTree(f.live);
      await expect(readDesignSystemPalette("test-system", f.env)).rejects.toMatchObject({ code: "palette_ownership_conflict" });
      await expect(saveDesignSystemPalette("test-system", { expected_digest: absent.expected_digest, state }, f.env)).rejects.toBeInstanceOf(Error);
      expect((await inspectContentTree(f.live)).inventory).toEqual(before.inventory);
      expect(listSystemContentReceipts(f.db)).toHaveLength(0);
    });
  test.each(["hard-link", "directory-link"] as const)("Given a %s reserved path When read Then linked bytes are never adopted", async kind => {
    const f = await setup();
    const target = path.join(f.systemsRoot, "external");
    await mkdir(target);
    await writeFile(path.join(target, "original"), "preserve");
    if (kind === "directory-link") await symlink(target, path.join(f.live, "palette"), process.platform === "win32" ? "junction" : "dir");
    else {
      await mkdir(path.join(f.live, "palette"));
      await link(path.join(target, "original"), path.join(f.live, "palette/state.json"));
    }
    await expect(readDesignSystemPalette("test-system", f.env)).rejects.toBeInstanceOf(Error);
    expect(await readFile(path.join(target, "original"), "utf8")).toBe("preserve");
  });
  test.each(["archived", "trashed", "missing", "missing-root"] as const)("Given a %s system When read and saved Then it is unavailable", async kind => {
    const f = await setup();
    const current = await readDesignSystemPalette("test-system", f.env);
    if (kind === "missing") f.db.query("DELETE FROM design_systems").run();
    else if (kind === "missing-root") await rm(f.live, { recursive: true });
    else f.db.query("UPDATE design_systems SET lifecycle=?").run(kind);
    await expect(readDesignSystemPalette("test-system", f.env)).rejects.toBeInstanceOf(Error);
    await expect(saveDesignSystemPalette("test-system", { expected_digest: current.expected_digest, state }, f.env)).rejects.toBeInstanceOf(Error);
    expect(listSystemContentReceipts(f.db)).toHaveLength(0);
  });
  test("Given an unknown recorded emitter When reopening Then generated looking bytes cannot authorize regeneration", async () => {
    const f = await setup();
    await save(f);
    const receipt = requiredReceipt(f);
    const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
    f.db.query("UPDATE design_system_receipts SET metadata_json=? WHERE id=?")
      .run(JSON.stringify({ ...journal, palette_history: { ...journal.palette_history, emitter_version: "future-2" } }), receipt.id);
    await expect(readDesignSystemPalette("test-system", f.env)).rejects.toMatchObject({ code: "system_content_corrupt" });
  });
  test("Given a different registered validator When saving Then publisher rejects it before publication", async () => {
    const f = await setup();
    const before = await readDesignSystemPalette("test-system", f.env);
    await expect(saveDesignSystemPalette("test-system", { expected_digest: before.expected_digest, state },
      { ...f.env, validators: { palette: async (...args) => validatePaletteContent(...args) } }))
      .rejects.toMatchObject({ code: "system_content_unavailable" });
    expect(listSystemContentReceipts(f.db)).toHaveLength(0);
  });
  test("Given v1 extraction evidence When a palette is saved Then the original sidecar and digest remain historical", async () => {
    const f = await setup();
    const raw = JSON.stringify(buildExtractionProvenance([], 1));
    const extraction = buildExtractionProvenance([], 1);
    await mkdir(path.join(f.live, "fonts"));
    for (const name of ["SKILL.md", "colors_and_type.css", "fonts/fonts.css"]) await writeFile(path.join(f.live, name), "original\r\n");
    await writeFile(path.join(f.live, "extraction-provenance.json"), raw);
    const tree = await inspectContentTree(f.live);
    f.db.query(`INSERT INTO design_system_receipts(id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at)
      VALUES ('extraction','test-system','committed',1,1,?,?,?,1,1)`).run(extraction.content_digest, JSON.stringify(tree.manifest), raw);
    const result = await save(f);
    expect(result.content_revision).toBe(2);
    expect(requiredReceipt(f).parentDigest).toBe(extraction.content_digest);
    expect(await readFile(path.join(f.live, "extraction-provenance.json"), "utf8")).toBe(raw);
    expect(f.db.query("SELECT digest,manifest_json FROM design_system_receipts WHERE id='extraction'").get())
      .toEqual({ digest: extraction.content_digest, manifest_json: JSON.stringify(tree.manifest) });
    await validateCatalogReceiptTree(f.live, requiredReceipt(f));
  });
  test.each(["duplicate", "derive"] as const)("Given a saved parent When %s produces validated lineage Then negative revision and child ownership survive", async operation => {
    const f = await setup();
    const parent = await save(f);
    const rulesEnv = { ...f.env, validators: { ...f.env.validators, rules: validateRules } };
    await publishSystemContent(rulesEnv, { systemId: "test-system", mode: "replace",
      expectedDigest: await expectedDigest(rulesEnv), adapter: rulesAdapter() });
    const copiedHead = requiredReceipt(f);
    // The legacy lifecycle helper uses uncached prepare statements. Own and finalize them explicitly.
    const prepared = spyOn(Database.prototype, "prepare");
    try {
      await copyCatalogSystem(f.db, f.systemsRoot, "test-system", { id: "child", name: "Child", operation, reason: null, metadata: {} });
    } finally {
      for (const result of prepared.mock.results) if (result.type === "return") result.value.finalize();
      prepared.mockRestore();
    }
    const child = await readDesignSystemPalette("child", f.env);
    expect(child.content_revision).toBeLessThan(0);
    expect(child.css).toBe(parent.css);
    const childReceipt = getCurrentSystemContent(f.db, "child");
    expect(childReceipt?.metadataJson).toBe("{}");
    expect(childReceipt?.parentReceiptId).toBe(copiedHead.id);
    const saved = await saveDesignSystemPalette("child", { expected_digest: child.expected_digest,
      state: { ...state, display: { ...state.display, appearance: "dark" } } }, f.env);
    expect(saved.content_revision).toBe(1);
    expect(getCurrentSystemContent(f.db, "child")?.parentReceiptId).toBe(childReceipt?.id);
    expect(getCatalogRow(f.db, "test-system")?.metadataRevision).toBe(0);
  });
});

describe("palette request and deterministic CSS boundaries", () => {
  test.each(["css", "path", "receipt", "system_id", "unknown"] as const)("Given client %s injection When parsed Then only the exact request shape is accepted", field => {
    expect(() => parseSaveDesignSystemPaletteRequest({ expected_digest: "a".repeat(64), state, [field]: "injected" })).toThrow();
  });
  test.each(["", "A".repeat(64), "a".repeat(63), null, 1])("Given an invalid digest %s When parsed Then it is rejected", expected_digest => {
    expect(() => parseSaveDesignSystemPaletteRequest({ expected_digest, state })).toThrow();
  });
  test.each([NaN, Infinity, -Infinity, 5])("Given an invalid amount %s When parsed Then it is rejected", amount => {
    expect(() => parseSaveDesignSystemPaletteRequest({ expected_digest: "a".repeat(64), state: { ...state, curve: { ...state.curve, amount } } })).toThrow();
  });
  test("Given too many stops When parsed Then bounded persistence rejects the state", () => {
    expect(() => parseSaveDesignSystemPaletteRequest({ expected_digest: "a".repeat(64), state: { ...state,
      stops: Array.from({ length: 65 }, (_, i) => ({ id: `x${i}`, name: `${i}`, position: 0.0625 + i / 80 })) } })).toThrow();
  });
  test("Given a state exceeding serialized JSON limits When parsed Then object input cannot bypass the bound", () => {
    const next = { ...state,
      stops: Array.from({ length: 64 }, (_, i) => ({ id: `s${i}${"x".repeat(77)}`, name: `${i}${"y".repeat(77)}`, position: 0.0625 + i / 80 })),
      scales: Array.from({ length: 64 }, (_, i) => ({ id: `c${i}${"x".repeat(77)}`, name: "y".repeat(80), kind: "neutral" })),
      anchors: Array.from({ length: 64 }, (_, i) => ({ id: `a${i}${"x".repeat(77)}`, name: "y".repeat(80),
        color: { space: "display-p3", r: 0.12345678901234567, g: 0.12345678901234567, b: 0.12345678901234567 } })) };
    // Escaped ASCII control-free punctuation increases serialized size without changing text limits.
    const escaped = { ...next, scales: next.scales.map((scale, i) => ({ ...scale, id: `c${i}${"\\".repeat(77)}`, name: "\\".repeat(80) })),
      anchors: next.anchors.map((anchor, i) => ({ ...anchor, id: `a${i}${"\\".repeat(77)}`, name: "\\".repeat(80) })),
      stops: next.stops.map((stop, i) => ({ ...stop, id: `s${i}${"\\".repeat(77)}`, name: `${stop.name.slice(0, 2)}${"\\".repeat(78)}` })) };
    expect(JSON.stringify(escaped).length).toBeGreaterThan(65_536);
    expect(() => parseSaveDesignSystemPaletteRequest({ expected_digest: "a".repeat(64), state: escaped })).toThrow();
  });
  test("Given maximum neutral scales and stops When emitted Then generated output stays within the history snapshot bound", () => {
    const next: PaletteState = { ...state, gamut: "display-p3",
      stops: Array.from({ length: 64 }, (_, i) => ({ id: `s${i.toString(36)}`, name: `${i}`, position: 0.0625 + i / 80 })),
      scales: Array.from({ length: 64 }, (_, i) => ({ id: `c${i.toString(36)}`, name: `${i}`, kind: "neutral" })) };
    const css = emitPaletteCss(next);
    expect(Buffer.byteLength(css)).toBeLessThanOrEqual(1024 * 1024);
    expect([...css.matchAll(/--bg-palette-scale-/g)]).toHaveLength(2 * 64 * 64);
  });
  test("Given all frozen brand anchors When emitted Then exact separate sRGB channels are retained", () => {
    const anchors = brandAnchors.rows.map(anchor => ({ id: anchor.id, name: anchor.name, color: parseHexColor(anchor.hex) }));
    const css = emitPaletteCss({ ...state, anchors });
    const channels = [...css.matchAll(/--bg-palette-anchor-[a-zA-Z0-9_-]+: color\(srgb ([^)]+)\)/g)].map(match => match[1]);
    expect(channels).toEqual(anchors.map(anchor => [anchor.color.r, anchor.color.g, anchor.color.b].join(" ")));
    expect(anchors).toHaveLength(43);
  });
  test("Given arbitrary validated IDs When emitted Then CSS names are bounded unique and contain no interpolated syntax", () => {
    const next: PaletteState = { ...state, stops: state.stops.map((stop, i) => ({ ...stop, id: `stop ${i};{}\\\"` })),
      scales: state.scales.map((scale, i) => ({ ...scale, id: i === 0 ? "\u00e9" : i === 1 ? "e\u0301" : `scale ${i};{}\\\"` })) };
    const css = emitPaletteCss(next);
    const names = [...css.matchAll(/(--bg-palette-[a-zA-Z0-9_-]+):/g)].map(match => match[1]);
    expect(names).toHaveLength(next.stops.length * next.scales.length);
    expect(new Set(names).size).toBe(names.length);
    expect(Math.max(...names.map(name => name?.length ?? 0))).toBeLessThanOrEqual(690);
    expect(css.includes("scale 0")).toBe(false);
    expect(emitPaletteCss(next)).toBe(css);
    expect(css.includes(":root")).toBe(false);
    expect(css.includes("@import")).toBe(false);
  });
  test("Given an exact Display P3 anchor When emitted Then wide channels stay exact and fallback is genuinely sRGB", () => {
    const next: PaletteState = { ...state, gamut: "display-p3", anchors: [{ id: "exact", name: "Exact",
      color: parseRgb({ space: "display-p3", r: 1, g: 0, b: 0 }) }] };
    const css = emitPaletteCss(next);
    const fallback = [...css.matchAll(/--bg-palette-anchor-[a-zA-Z0-9_-]+: color\(srgb ([^)]+)\)/g)];
    const wide = [...css.matchAll(/--bg-palette-anchor-[a-zA-Z0-9_-]+: color\(display-p3 ([^)]+)\)/g)];
    expect(wide.map(match => match[1])).toEqual(["1 0 0"]);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.[1]).not.toBe("1 0 0");
    for (const channel of (fallback[0]?.[1] ?? "").split(" ").map(Number)) {
      expect(Number.isFinite(channel) && channel >= 0 && channel <= 1).toBe(true);
    }
    expect(css).toContain("@supports (color: color(display-p3 1 0 0))");
  });
});

const capability = "palette-test-capability";
function app() { return createApp({ capability, bootstrapSecret: "palette-test-bootstrap", appAuthority: "127.0.0.1:14070" }); }
function request(id: string, method = "GET", body?: unknown, overrides?: Record<string, string>) {
  return new Request(`http://127.0.0.1:14070/api/design-systems/${id}/palette`, { method,
    headers: { host: "127.0.0.1:14070", origin: "http://127.0.0.1:14070",
      [BURNGUARD_CAPABILITY_HEADER]: capability, ...(body === undefined ? {} : { "content-type": "application/json" }), ...overrides },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function routeFixture() {
  const id = `palette-${randomUUID()}`;
  routeIds.push(id);
  const live = path.join(systemsDir, id);
  await mkdir(live, { recursive: true });
  await writeFile(path.join(live, "README.md"), "route\r\n");
  getSqlite().query("INSERT INTO design_systems(id,name,status,dir_path,created_at,updated_at) VALUES (?,?,'draft',?,1,1)").run(id, "Route", live);
  return id;
}
describe("production palette route authority", () => {
  test("Given palette and raw file URLs When classified Then the production dispatcher selects their real domains", () => {
    for (const method of ["GET", "PUT"]) expect(classifyApiRoute("/api/design-systems/test/palette", method)).toBe("system");
    expect(classifyApiRoute("/api/design-systems/test/files/palette/state.json", "GET")).toBe("catalog");
  });
  test("Given real route authority and SQLite When PUT saves Then GET returns the actual persisted pair", async () => {
    const id = await routeFixture();
    const current = await readDesignSystemPalette(id);
    const response = await app().request(request(id, "PUT", { expected_digest: current.expected_digest, state }));
    expect(response.status).toBe(200);
    expect((await app().request(request(id))).status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toEqual({ data: await readDesignSystemPalette(id) });
  });
  test.each([["host", "evil.test", 421], ["origin", "http://evil.test", 403],
    [BURNGUARD_CAPABILITY_HEADER, "wrong", 403]] as const)(
    "Given hostile %s When PUT enters the production app Then it is rejected with %s", async (header, value, status) => {
      const id = await routeFixture();
      const current = await readDesignSystemPalette(id);
      expect((await app().request(request(id, "PUT", { expected_digest: current.expected_digest, state }, { [header]: value }))).status).toBe(status);
      expect((await readDesignSystemPalette(id)).state).toBeNull();
    });
  test("Given no capability When GET enters the production app Then it is rejected", async () => {
    const req = request("missing");
    req.headers.delete(BURNGUARD_CAPABILITY_HEADER);
    expect((await app().request(req)).status).toBe(403);
  });
  test("Given an oversized JSON body When production PUT enters Then the existing body gate rejects it", async () => {
    const req = request("missing", "PUT", { padding: "x".repeat(1024 * 1024 + 1) });
    expect((await app().request(req)).status).toBe(413);
  });
  test("Given a client CSS field When production PUT enters Then no receipt is created", async () => {
    const id = await routeFixture();
    const current = await readDesignSystemPalette(id);
    const response = await app().request(request(id, "PUT", { expected_digest: current.expected_digest, state, css: "injected" }));
    expect(response.status).toBe(400);
    expect((await readDesignSystemPalette(id)).state).toBeNull();
  });
  test("Given an unsafe path component When production GET enters Then the path gate returns only a stable error", async () => {
    const response = await app().request(request("C%3Aprivate"));
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { code: "invalid_body" } });
    expect(JSON.stringify(body).includes("private")).toBe(false);
    expect(JSON.stringify(body).includes(capability)).toBe(false);
  });
  test("Given an old valid token When production PUT repeats after commit Then it returns a real 412", async () => {
    const id = await routeFixture();
    const current = await readDesignSystemPalette(id);
    await saveDesignSystemPalette(id, { expected_digest: current.expected_digest, state });
    const response = await app().request(request(id, "PUT", { expected_digest: current.expected_digest, state }));
    expect(response.status).toBe(412);
    expect(await response.json()).toMatchObject({ error: { code: "expected_digest_conflict" } });
  });
});
