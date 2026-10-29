import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_SOURCE_ATTRIBUTE } from "@bg/shared";
import { createDesignSystemRecord } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { applyLogoDesignSystemPatch, LogoDesignSystemPatchError } from "../src/services/logo-design-system-sync";
import { getCurrentSystemContent } from "../src/db/catalog-repository";
import { authoringContentEnvironment } from "../src/services/design-system-authoring";
import { validateCatalogReceiptTree } from "../src/services/catalog-files";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { createDefaultPalette } from "@bg/shared/palette";
import { buildExtractionProvenance } from "../src/services/extraction-provenance";
import { parseContentJournal } from "../src/services/system-content-format";
import { recoverSystemContent } from "../src/services/system-content-publication";
import { inspectContentTree } from "../src/services/system-content-tree";

let systemId: string;
let systemDir: string;
const README_TAIL = "## Typography\n\nKeep the existing ramp.\n";
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" ${LOGO_SOURCE_ATTRIBUTE}="explorations/round-1/candidate-2.png"><path d="M0 0H512V512H0Z"/></svg>`;
const patch = {
  schema_version: 1,
  colors: [
    { name: "logo-primary", value: "#112233" },
    { name: "logo-accent", value: "#FFAA00" },
  ],
  readme_section: "## Logo\n\nClear space equals the height of the mark's counterform.\n",
  logo_asset: "logo.svg",
};

const projectDirs: string[] = [];

async function projectStage(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "burnguard-logo-sync-"));
  projectDirs.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
}

function systemCount(): unknown {
  return getSqlite().query("SELECT COUNT(*) AS count FROM design_systems").get();
}

async function extractionBaseline() {
  const evidence = buildExtractionProvenance([], 1);
  const raw = JSON.stringify(evidence);
  await mkdir(path.join(systemDir, "fonts"));
  await writeFile(path.join(systemDir, "fonts/fonts.css"), "");
  await writeFile(path.join(systemDir, "SKILL.md"), "source\r\n");
  await writeFile(path.join(systemDir, "extraction-provenance.json"), raw);
  const tree = await inspectContentTree(systemDir);
  getSqlite().query(`INSERT INTO design_system_receipts(id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at)
    VALUES (?,?,'committed',1,1,?,?,?,1,1)`).run(`extraction-${systemId}`, systemId, evidence.content_digest, JSON.stringify(tree.manifest), raw);
  return { raw, original: getCurrentSystemContent(getSqlite(), systemId) };
}

beforeEach(async () => {
  systemId = `logo-sync-${crypto.randomUUID()}`;
  systemDir = path.join(systemsDir, systemId);
  await mkdir(systemDir, { recursive: true });
  await writeFile(path.join(systemDir, "colors_and_type.css"), ":root { --brand-ink: #101010; }\n");
  await writeFile(
    path.join(systemDir, "README.md"),
    `# System\n\n## Colors\n\nExisting colours.\n\n## Logo\n\nStale logo prose that must not survive.\n\n${README_TAIL}`,
  );
  await createDesignSystemRecord({
    id: systemId,
    name: "Logo sync",
    description: null,
    status: "published",
    sourceType: "manual",
    sourceUri: null,
    dirPath: systemDir,
    skillMdPath: null,
    tokensCssPath: path.join(systemDir, "colors_and_type.css"),
    readmeMdPath: path.join(systemDir, "README.md"),
    thumbnailPath: null,
  });
});

afterEach(async () => {
  getSqlite().query("DELETE FROM design_systems WHERE id=?").run(systemId);
  await rm(systemDir, { recursive: true, force: true });
  for (const dir of projectDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("logo design system sync", () => {
  test("Given no design system When applied Then it is a no-op", async () => {
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: null, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({ applied: false, reason: "no_design_system" });
  });

  test("Given no patch file When applied Then it is a no-op", async () => {
    const dir = await projectStage({ "logo.svg": LOGO_SVG });
    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({ applied: false, reason: "patch_absent" });
  });

  test("Given a patch When applied twice Then colours, README and asset land idempotently and no system row is created", async () => {
    const before = systemCount();
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });

    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({
      applied: true,
      colors: 2,
      readme: "replaced",
      asset: true,
    });

    const css = await readFile(path.join(systemDir, "colors_and_type.css"), "utf8");
    expect(css).toContain("#112233");
    expect(css).toContain("#FFAA00");
    expect(css).toContain("--brand-ink");
    const readme = await readFile(path.join(systemDir, "README.md"), "utf8");
    expect(readme).toContain("Clear space equals the height of the mark's counterform.");
    expect(readme).not.toContain("Stale logo prose that must not survive.");
    expect(readme).toContain("## Colors");
    expect(readme).toContain("## Typography");
    expect(await readFile(path.join(systemDir, "assets", "logo.svg"), "utf8")).toBe(LOGO_SVG);
    expect(systemCount()).toEqual(before);
    const receipt = getCurrentSystemContent(getSqlite(), systemId);
    if (receipt === null) throw new Error("Missing logo receipt");
    expect(receipt.contentRevision).toBe(1);
    expect(parseContentJournal(JSON.parse(receipt.metadataJson))).toMatchObject({
      write_set: ["README.md", "assets/logo.svg", "colors_and_type.css"], palette_history: null,
    });
    expect(JSON.parse(receipt.provenanceJson).writer).toBe("logo");
    await validateCatalogReceiptTree(systemDir, receipt);

    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({
      applied: true,
      colors: 2,
      readme: "replaced",
      asset: true,
    });
    expect(await readFile(path.join(systemDir, "README.md"), "utf8")).toBe(readme);
    expect(systemCount()).toEqual(before);
    expect(getCurrentSystemContent(getSqlite(), systemId)?.id).toBe(receipt.id);
  });

  test.each(["legacy", "v1"] as const)("Given a %s tree with a saved palette When the logo publishes Then one receipt preserves the pair original sidecar and unrelated bytes", async baseline => {
    await mkdir(path.join(systemDir, ".git", "empty"), { recursive: true });
    await mkdir(path.join(systemDir, "empty"));
    await writeFile(path.join(systemDir, ".git/payload"), Buffer.from([0, 255, 13, 10]));
    await writeFile(path.join(systemDir, "unrelated.txt"), "keep\r\n");
    let original: ReturnType<typeof getCurrentSystemContent> = null;
    let raw: string | null = null;
    if (baseline === "v1") {
      ({ raw, original } = await extractionBaseline());
    }
    const env = paletteContentEnvironment();
    const current = await readDesignSystemPalette(systemId, env);
    const saved = await saveDesignSystemPalette(systemId, { expected_digest: current.expected_digest, state: createDefaultPalette() }, env);
    const before = await inspectContentTree(systemDir);
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });

    await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" });

    const receipt = getCurrentSystemContent(getSqlite(), systemId);
    if (receipt === null) throw new Error("Missing logo receipt");
    expect(receipt.contentRevision).toBe(saved.content_revision + 1);
    expect(parseContentJournal(JSON.parse(receipt.metadataJson))).toMatchObject({
      write_set: ["README.md", "assets/logo.svg", "colors_and_type.css"], palette_history: null,
    });
    const changed = new Set(["README.md", "assets", "assets/logo.svg", "colors_and_type.css"]);
    expect((await inspectContentTree(systemDir)).inventory.filter(entry => !changed.has(entry[1])))
      .toEqual(before.inventory.filter(entry => !changed.has(entry[1])));
    expect((await readDesignSystemPalette(systemId, env)).state).toEqual(saved.state);
    await validateCatalogReceiptTree(systemDir, receipt);
    if (original !== null && raw !== null) {
      expect(await readFile(path.join(systemDir, "extraction-provenance.json"), "utf8")).toBe(raw);
      expect(JSON.parse(receipt.provenanceJson).source_extraction).toEqual({ receipt_id: original.id, digest: original.digest });
      expect(getSqlite().query("SELECT digest,manifest_json FROM design_system_receipts WHERE id=?").get(original.id))
        .toEqual({ digest: original.digest, manifest_json: original.manifestJson });
    }
  });

  test("Given committed v1 extraction When a multi-color logo patch publishes directly Then one v2 receipt retains original provenance", async () => {
    const { raw, original } = await extractionBaseline();
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" });
    const receipt = getCurrentSystemContent(getSqlite(), systemId);
    if (receipt === null || original === null) throw new Error("Missing extraction fixture");
    expect(receipt.schemaVersion).toBe(2);
    expect(receipt.contentRevision).toBe(2);
    expect(receipt.parentDigest).toBe(original.digest);
    expect(JSON.parse(receipt.provenanceJson).source_extraction).toEqual({ receipt_id: original.id, digest: original.digest });
    expect(await readFile(path.join(systemDir, "extraction-provenance.json"), "utf8")).toBe(raw);
    await validateCatalogReceiptTree(systemDir, receipt);
  });

  test("Given a complete logo patch When commit is faulted Then every color README and asset rolls back together and recovery is idempotent", async () => {
    const env = authoringContentEnvironment();
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    const before = await inspectContentTree(systemDir);

    await expect(applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" }, {
      ...env, atBoundary: async name => { if (name === "before-commit") throw new Error("injected_before_commit"); },
    })).rejects.toMatchObject({ code: "system_content_failed" });

    expect(getCurrentSystemContent(getSqlite(), systemId)).toBeNull();
    expect((await inspectContentTree(systemDir)).inventory).toEqual(before.inventory);
    expect(await recoverSystemContent(env)).toMatchObject({ held: [] });
    expect(await recoverSystemContent(env)).toMatchObject({ held: [] });
    expect((await inspectContentTree(systemDir)).preservation_digest).toBe(before.preservation_digest);
  });

  test("Given palette staging holds the lease When a multi-color logo patch starts Then the palette and the complete logo both commit", async () => {
    const env = paletteContentEnvironment();
    const current = await readDesignSystemPalette(systemId, env);
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    let entered = () => {};
    let release = () => {};
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const saved = saveDesignSystemPalette(systemId, { expected_digest: current.expected_digest, state: createDefaultPalette() }, {
      ...env, atBoundary: async name => { if (name === "stage-synced") { entered(); await gate; } },
    });
    let enqueued = () => {};
    const queued = new Promise<void>(resolve => { enqueued = resolve; });
    let logo: Promise<unknown> | undefined;
    try {
      await Promise.race([reached, saved.then(() => { throw new Error("Missing stage barrier"); })]);
      logo = applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" }, {
        ...authoringContentEnvironment(), onAccessQueued: enqueued,
      });
      await Promise.race([queued, logo.then(() => { throw new Error("Writer bypassed shared access"); })]);
      expect(getCurrentSystemContent(getSqlite(), systemId)).toBeNull();
    } finally { release(); }
    await Promise.all([saved, logo]);
    expect((await readDesignSystemPalette(systemId, env)).state).toEqual(createDefaultPalette());
    const receipt = getCurrentSystemContent(getSqlite(), systemId);
    if (receipt === null) throw new Error("Missing concurrent receipt");
    expect(receipt.contentRevision).toBe(2);
    expect(parseContentJournal(JSON.parse(receipt.metadataJson)).palette_history).toBeNull();
    const css = await readFile(path.join(systemDir, "colors_and_type.css"), "utf8");
    for (const color of patch.colors) expect(css).toContain(`--${color.name}: ${color.value};`);
    expect(await readFile(path.join(systemDir, "assets/logo.svg"), "utf8")).toBe(LOGO_SVG);
    await validateCatalogReceiptTree(systemDir, receipt);
  });

  test("Given a patch saved with a UTF-8 BOM and CRLF When applied Then it applies like the plain patch", async () => {
    const dir = await projectStage({ "design-system-patch.json": `\uFEFF${JSON.stringify(patch)}\r\n`, "logo.svg": LOGO_SVG });
    expect([...(await readFile(path.join(dir, "design-system-patch.json"))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toMatchObject({ applied: true, colors: 2, asset: true });
  });

  test("Given a README without a logo section When applied Then the section is appended", async () => {
    await writeFile(path.join(systemDir, "README.md"), "# System\n\n## Colors\n\nOnly colours.\n");
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    const result = await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" });
    expect(result).toEqual({ applied: true, colors: 2, readme: "appended", asset: true });
    const readme = await readFile(path.join(systemDir, "README.md"), "utf8");
    expect(readme.indexOf("## Colors")).toBeLessThan(readme.indexOf("## Logo"));
    expect(readme.endsWith("\n")).toBe(true);
  });

  test.each([
    ["active content", LOGO_SVG.replace("</svg>", "<script>alert(1)</script></svg>"), "svg_forbidden_element:script"],
    ["external reference", LOGO_SVG.replace("</svg>", '<use href="https://example.com/logo.svg#mark"/></svg>'), "svg_external_reference"],
    ["another selected source", LOGO_SVG.replace("candidate-2.png", "candidate-3.png"), "svg_source_mismatch"],
    ["missing source", LOGO_SVG.replace(` ${LOGO_SOURCE_ATTRIBUTE}="explorations/round-1/candidate-2.png"`, ""), "svg_source_missing"],
  ])("Given an SVG with %s When promoted Then a typed failure leaves the system unchanged", async (_label, svg, detail) => {
    const files = ["colors_and_type.css", "README.md", "assets/logo.svg"];
    await mkdir(path.join(systemDir, "assets"), { recursive: true });
    await writeFile(path.join(systemDir, "assets", "logo.svg"), LOGO_SVG);
    const before = await Promise.all(files.map((file) => readFile(path.join(systemDir, file))));
    const dir = await projectStage({
      "design-system-patch.json": JSON.stringify({
        ...patch,
        colors: [{ name: "logo-rejected", value: "#ABCDEF" }],
        readme_section: "## Logo\n\nRejected replacement.\n",
      }),
      "logo.svg": svg,
    });
    const input = { projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" };

    const result = await applyLogoDesignSystemPatch(input).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(LogoDesignSystemPatchError);
    expect(result).toMatchObject({ code: "logo_design_system_patch_failed", detail });
    expect(await Promise.all(files.map((file) => readFile(path.join(systemDir, file))))).toEqual(before);
  });

  test("Given a malformed patch When applied Then a typed failure is thrown and nothing is written", async () => {
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify({ ...patch, colors: [{ name: "Logo Primary", value: "#112233" }] }), "logo.svg": LOGO_SVG });
    await expect(applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).rejects.toMatchObject({
      code: "logo_design_system_patch_failed",
      detail: "patch_invalid:colors.0.name",
    });
  });

  test("Given a missing logo asset When applied Then a typed failure is thrown", async () => {
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch) });
    await expect(applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).rejects.toMatchObject({
      code: "logo_design_system_patch_failed",
      detail: "logo_asset_missing",
    });
  });

  test("Given an unknown design system When applied Then a typed failure is thrown and no row appears", async () => {
    const before = systemCount();
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    await expect(applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: `${systemId}-unknown`, expectedSource: "explorations/round-1/candidate-2.png" })).rejects.toMatchObject({
      code: "logo_design_system_patch_failed",
      detail: "design_system_missing",
    });
    expect(systemCount()).toEqual(before);
  });
});
