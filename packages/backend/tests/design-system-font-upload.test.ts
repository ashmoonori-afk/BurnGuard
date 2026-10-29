import { afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as fsp from "node:fs/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { persistCanonicalExtraction, uploadDesignSystemFont, upsertDesignSystemColorToken } from "../src/services/design-system-extract";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { createDesignSystemRecord } from "../src/db/seed";
import { getCurrentSystemContent, getPendingSystemOperation } from "../src/db/catalog-repository";
import { listSystemContentReceipts } from "../src/db/design-system-repository";
import { authoringContentEnvironment } from "../src/services/design-system-authoring";
import { validateCatalogReceiptTree } from "../src/services/catalog-files";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { createDefaultPalette } from "@bg/shared/palette";
import { parseContentJournal } from "../src/services/system-content-format";
import { recoverSystemContent } from "../src/services/system-content-publication";
import { inspectContentTree } from "../src/services/system-content-tree";
import { copyCatalogSystem } from "../src/services/catalog-lifecycle";
import { defaultManagedTreeIo } from "../src/services/artifact-tree-storage";

let id: string;
let root: string;
let tokenPath: string;
let fontsCssPath: string;
let figtree: Buffer<ArrayBuffer>;
const childIds: string[] = [];

beforeAll(async () => {
  figtree = await readFile(path.resolve(import.meta.dir, "../../../assets/fonts/Figtree.woff2"));
});

beforeEach(async () => {
  id = `font-upload-${crypto.randomUUID()}`;
  root = path.join(systemsDir, id);
  tokenPath = path.join(root, "colors_and_type.css");
  fontsCssPath = path.join(root, "fonts", "fonts.css");
  await mkdir(path.dirname(fontsCssPath), { recursive: true });
  await writeFile(tokenPath, ':root { --font-sans: "Original", var(--font-sans-fallback); --brand: #112233; }\n');
  await writeFile(fontsCssPath, ':root { --font-sans-fallback: sans-serif; }\n');
  await createDesignSystemRecord({ id, name: id, description: null, status: "published", sourceType: "manual", sourceUri: null,
    dirPath: root, skillMdPath: null, tokensCssPath: tokenPath, readmeMdPath: null, thumbnailPath: null });
});

async function extractedBaseline() {
  getSqlite().query("DELETE FROM design_systems WHERE id=?").run(id);
  await rm(root, { recursive: true });
  const source = await mkdtemp(path.join(tmpdir(), "bg-font-upload-source-"));
  try {
    const analysis = await analyzeLocalTree(source, "Font fixture", new AbortController().signal);
    await persistCanonicalExtraction({ requestedId: id, brandName: "Font fixture", sourceType: "upload", sourceReference: "fixture.pdf", lineage: null, analysis, signal: new AbortController().signal });
  } finally { await rm(source, { recursive: true, force: true }); }
}

afterEach(async () => {
  for (const target of [...childIds.splice(0), id]) {
    getSqlite().query("DELETE FROM design_systems WHERE id=?").run(target);
    await rm(path.join(systemsDir, target), { recursive: true, force: true });
  }
});

test("CSS-14: Given an extracted system whose fonts.css defines the role fallback When a font is uploaded Then the token keeps referencing the fallback variable", async () => {
  await extractedBaseline();
  const original = getCurrentSystemContent(getSqlite(), id);
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "extracted-sans.woff2"), family: "Extracted Sans", role: "sans" });
  const tokens = await readFile(tokenPath, "utf8");
  expect(tokens).toMatch(/--font-sans:\s*"Extracted Sans", var\(--font-sans-fallback\);/);
  expect(original?.schemaVersion).toBe(1);
  expect(getCurrentSystemContent(getSqlite(), id)?.contentRevision).toBe(2);
});

test.each(["v1", "v2"] as const)("Given a %s parent and negative copied lineage When token and font writers publish Then positive child receipts retain original extraction lineage", async version => {
  await extractedBaseline();
  const extraction = getCurrentSystemContent(getSqlite(), id);
  if (extraction === null) throw new Error("Missing extraction receipt");
  const sidecar = await readFile(path.join(root, "extraction-provenance.json"));
  const paletteEnv = paletteContentEnvironment();
  if (version === "v2") {
    const initial = await readDesignSystemPalette(id, paletteEnv);
    await saveDesignSystemPalette(id, { expected_digest: initial.expected_digest, state: createDefaultPalette() }, paletteEnv);
  }
  const before = await inspectContentTree(root);
  const child = `writer-child-${crypto.randomUUID()}`;
  childIds.push(child);
  // Own the legacy copy helper's uncached statements; cleanup must not depend on GC.
  const prepared = spyOn(Database.prototype, "prepare");
  try {
    await copyCatalogSystem(getSqlite(), systemsDir, id, { id: child, name: child, operation: "derive", reason: null, metadata: {} });
  } finally {
    for (const result of prepared.mock.results) if (result.type === "return") result.value.finalize();
    prepared.mockRestore();
  }
  const lineage = getCurrentSystemContent(getSqlite(), child);
  expect(lineage?.contentRevision).toBeLessThan(0);
  const childRoot = path.join(systemsDir, child);

  await upsertDesignSystemColorToken(child, { name: "child-only", value: "#AABBCC" });
  const token = getCurrentSystemContent(getSqlite(), child);
  expect(token?.contentRevision).toBe(1);
  expect(token?.parentReceiptId).toBe(lineage?.id);
  expect(token?.parentDigest).toBe(lineage?.digest);
  await uploadDesignSystemFont({ systemId: child, file: new File([figtree], "child.woff2"), family: "Child Font", role: "sans" });

  const font = getCurrentSystemContent(getSqlite(), child);
  if (font === null) throw new Error("Missing child receipt");
  expect(font.contentRevision).toBe(2);
  expect(JSON.parse(font.provenanceJson).source_extraction).toEqual({ receipt_id: extraction.id, digest: extraction.digest });
  expect(parseContentJournal(JSON.parse(font.metadataJson)).palette_history).toBeNull();
  expect(await readFile(path.join(childRoot, "extraction-provenance.json"))).toEqual(sidecar);
  expect((await inspectContentTree(root)).preservation_digest).toBe(before.preservation_digest);
  if (version === "v2") expect((await readDesignSystemPalette(child, paletteEnv)).state).toEqual(createDefaultPalette());
  await validateCatalogReceiptTree(childRoot, font);
});

test("Given a current token and installed font When the identical edits are saved Then neither writer appends a receipt", async () => {
  await upsertDesignSystemColorToken(id, { name: "same", value: "#123456" });
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "same.woff2"), family: "Same Family", role: "sans" });
  const receipt = getCurrentSystemContent(getSqlite(), id);
  await upsertDesignSystemColorToken(id, { name: "same", value: "#123456" });
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "same.woff2"), family: "Same Family", role: "sans" });
  expect(getCurrentSystemContent(getSqlite(), id)?.id).toBe(receipt?.id);
});

test("Given invalid or oversized font input When upload is rejected Then no access request tree change or receipt exists", async () => {
  const before = await inspectContentTree(root);
  let requested = 0;
  const env = { ...authoringContentEnvironment(), onAccessQueued: () => { requested += 1; } };
  for (const file of [new File(["invalid"], "bad.woff2"), new File([new Uint8Array(16_000_001)], "large.ttf")]) {
    await expect(uploadDesignSystemFont({ systemId: id, file }, env)).rejects.toMatchObject({ code: "invalid_font_upload" });
  }
  expect(requested).toBe(0);
  expect((await inspectContentTree(root)).inventory).toEqual(before.inventory);
  expect(getCurrentSystemContent(getSqlite(), id)).toBeNull();
});

test("Given a font without a role When uploaded Then only the binary and fonts stylesheet appear in the receipt write set", async () => {
  const tokens = await readFile(tokenPath);
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "asset-only.woff2"), family: "Asset Only" });
  const receipt = getCurrentSystemContent(getSqlite(), id);
  if (receipt === null) throw new Error("Missing font receipt");
  expect(parseContentJournal(JSON.parse(receipt.metadataJson)).write_set).toEqual(["fonts/asset-only.woff2", "fonts/fonts.css"]);
  expect(await readFile(tokenPath)).toEqual(tokens);
});

test.each(["token", "font"] as const)("Given canonical v1 drift When a %s writer attempts an edit Then authority fails without adopting or erasing external bytes", async writer => {
  await extractedBaseline();
  const original = getCurrentSystemContent(getSqlite(), id);
  await writeFile(tokenPath, ":root { --external: #ABCDEF; }\r\n");
  const before = await inspectContentTree(root);
  const operation = writer === "token"
    ? upsertDesignSystemColorToken(id, { name: "new", value: "#123456" })
    : uploadDesignSystemFont({ systemId: id, file: new File([figtree], "drift.woff2"), role: "sans" });
  await expect(operation).rejects.toMatchObject({ code: "system_content_conflict" });
  expect((await inspectContentTree(root)).inventory).toEqual(before.inventory);
  expect(getCurrentSystemContent(getSqlite(), id)?.id).toBe(original?.id);
  expect(getPendingSystemOperation(getSqlite(), id)).toBeNull();
});

test.each(["token", "font"] as const)("Given %s rollback interrupted at restore When a fresh environment recovers Then its exported validator restores the exact old tree", async writer => {
  const env = authoringContentEnvironment();
  const before = await inspectContentTree(root);
  const faulted = {
    ...env,
    atBoundary: async (name: string) => { if (name === "before-commit") throw new Error("injected_before_commit"); },
    io: { ...defaultManagedTreeIo, rename: async (from: string, to: string) => {
      if (path.basename(from) === "previous") throw new Error("injected_restore_failure");
      await defaultManagedTreeIo.rename(from, to);
    } },
  };
  const operation = writer === "token"
    ? upsertDesignSystemColorToken(id, { name: "recoverable", value: "#123456" }, faulted)
    : uploadDesignSystemFont({ systemId: id, file: new File([figtree], "recoverable.woff2"), family: "Recoverable", role: "sans" }, faulted);
  await expect(operation).rejects.toMatchObject({ code: "system_content_failed" });
  const pending = getPendingSystemOperation(getSqlite(), id);
  if (pending === null) throw new Error("Missing rollback journal");
  expect(parseContentJournal(JSON.parse(pending.metadataJson)).intent).toBe("rollback");
  await expect(upsertDesignSystemColorToken(id, { name: "blocked", value: "#123456" })).rejects.toMatchObject({ code: "system_content_unavailable" });

  expect(await recoverSystemContent(authoringContentEnvironment())).toMatchObject({ held: [] });
  expect(await recoverSystemContent(authoringContentEnvironment())).toMatchObject({ held: [] });
  expect(getPendingSystemOperation(getSqlite(), id)).toBeNull();
  expect(getCurrentSystemContent(getSqlite(), id)).toBeNull();
  expect((await inspectContentTree(root)).inventory).toEqual(before.inventory);
});

test("CSS-14: Given a system with a literal --font-sans stack and no fallback variables When a font is uploaded Then the family is prepended to the existing stack and no undefined variable is referenced", async () => {
  await writeFile(tokenPath, ':root {\n  --font-sans: "Geist", "Pretendard", sans-serif;\n}\n', "utf8");
  await writeFile(fontsCssPath, "", "utf8");
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "brand-sans.woff2"), family: "Brand Sans", role: "sans" });
  const tokens = await readFile(tokenPath, "utf8");
  expect(tokens).toMatch(/--font-sans:\s*"Brand Sans", "Geist", "Pretendard", sans-serif;/);
  expect(tokens).not.toContain("var(--font-sans-fallback)");
});

test("CSS-14: Given a system without a role token or fallback When a font is uploaded Then the token gets a literal generic fallback", async () => {
  await writeFile(tokenPath, ":root {\n  --primary-blue: #0057B8;\n}\n", "utf8");
  await writeFile(fontsCssPath, "", "utf8");
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "brand-mono.woff2"), family: "Brand Mono", role: "mono" });
  const tokens = await readFile(tokenPath, "utf8");
  expect(tokens).toMatch(/--font-mono:\s*"Brand Mono", "Pretendard", monospace;/);
});

test("CSS-14: Given a static font upload without a weight When fonts.css is appended Then its @font-face declares font-weight 400", async () => {
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "brand-mono.woff2"), family: "Brand Mono", role: "mono" });
  const fontsCss = await readFile(fontsCssPath, "utf8");
  const rule = fontsCss.slice(fontsCss.indexOf("url('./brand-mono.woff2')"));
  expect(rule).toMatch(/font-weight:\s*400;/);
  expect(fontsCss).not.toContain("font-weight: 100 900");
});

test.each(["legacy", "v1"] as const)("Given a %s system and palette When token and font writers publish Then receipts advance without altering original evidence or unrelated bytes", async baseline => {
  if (baseline === "v1") await extractedBaseline();
  const original = getCurrentSystemContent(getSqlite(), id);
  const sidecar = baseline === "v1" ? await readFile(path.join(root, "extraction-provenance.json")) : null;
  await mkdir(path.join(root, ".git", "empty"), { recursive: true });
  await mkdir(path.join(root, "empty"));
  await writeFile(path.join(root, ".git", "payload"), Buffer.from([0, 255, 13, 10]));
  // Excluded bytes do not drift a v1 manifest; an included CRLF file is installed before local authority.
  if (baseline === "legacy") await writeFile(path.join(root, "unrelated.txt"), "unchanged\r\n");
  const paletteEnv = paletteContentEnvironment();
  const initial = await readDesignSystemPalette(id, paletteEnv);
  const palette = await saveDesignSystemPalette(id, { expected_digest: initial.expected_digest, state: createDefaultPalette() }, paletteEnv);
  const before = await inspectContentTree(root);
  const env = authoringContentEnvironment();

  await upsertDesignSystemColorToken(id, { name: "writer-accent", value: "#123456" }, env);
  const tokenReceipt = getCurrentSystemContent(getSqlite(), id);
  expect(tokenReceipt?.contentRevision).toBe(palette.content_revision + 1);
  expect(parseContentJournal(JSON.parse(tokenReceipt?.metadataJson ?? "null")).write_set).toEqual(["colors_and_type.css"]);
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "receipt.woff2"), family: "Receipt Font", role: "sans" }, env);
  const receipt = getCurrentSystemContent(getSqlite(), id);
  if (receipt === null) throw new Error("Missing writer receipt");
  expect(receipt.contentRevision).toBe(palette.content_revision + 2);
  expect(parseContentJournal(JSON.parse(receipt.metadataJson))).toMatchObject({
    write_set: ["colors_and_type.css", "fonts/fonts.css", "fonts/receipt.woff2"], palette_history: null,
  });
  const after = await inspectContentTree(root);
  const edited = new Set(["colors_and_type.css", "fonts/fonts.css", "fonts/receipt.woff2"]);
  expect(after.inventory.filter(entry => !edited.has(entry[1]))).toEqual(before.inventory.filter(entry => !edited.has(entry[1])));
  await validateCatalogReceiptTree(root, receipt);
  expect((await readDesignSystemPalette(id, paletteEnv)).state).toEqual(palette.state);
  if (original !== null && sidecar !== null) {
    expect(getSqlite().query("SELECT digest,manifest_json,provenance_json FROM design_system_receipts WHERE id=?").get(original.id))
      .toEqual({ digest: original.digest, manifest_json: original.manifestJson, provenance_json: original.provenanceJson });
    expect(JSON.parse(receipt.provenanceJson).source_extraction).toEqual({ receipt_id: original.id, digest: original.digest });
    expect(await readFile(path.join(root, "extraction-provenance.json"))).toEqual(sidecar);
  }
});

test.each(["token", "font"] as const)("Given a %s writer fault before commit When publication fails Then the full old tree and committed head survive recovery", async writer => {
  const env = authoringContentEnvironment();
  await upsertDesignSystemColorToken(id, { name: "baseline", value: "#102030" }, env);
  const before = await inspectContentTree(root);
  const head = getCurrentSystemContent(getSqlite(), id);
  const failed = { ...env, atBoundary: async (name: string) => { if (name === "before-commit") throw new Error("injected_before_commit"); } };
  const operation = writer === "token"
    ? upsertDesignSystemColorToken(id, { name: "rolled-back", value: "#ABCDEF" }, failed)
    : uploadDesignSystemFont({ systemId: id, file: new File([figtree], "rolled-back.woff2"), family: "Rolled Back", role: "sans" }, failed);

  await expect(operation).rejects.toMatchObject({ code: "system_content_failed" });
  expect((await inspectContentTree(root)).inventory).toEqual(before.inventory);
  expect(getCurrentSystemContent(getSqlite(), id)?.id).toBe(head?.id);
  expect(await recoverSystemContent(env)).toMatchObject({ held: [] });
  expect(await recoverSystemContent(env)).toMatchObject({ held: [] });
  expect((await inspectContentTree(root)).preservation_digest).toBe(before.preservation_digest);
});

test.each(["token", "font"] as const)("Given palette staging paused under its lease When a %s writer starts Then both serialized edits remain", async writer => {
  const paletteEnv = paletteContentEnvironment();
  const env = authoringContentEnvironment();
  const current = await readDesignSystemPalette(id, paletteEnv);
  let entered = () => {};
  let release = () => {};
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saved = saveDesignSystemPalette(id, { expected_digest: current.expected_digest, state: createDefaultPalette() }, {
    ...paletteEnv, atBoundary: async name => { if (name === "stage-synced") { entered(); await gate; } },
  });
  // Attach rejection before waiting for the stage event, so a failed save also releases this test.
  const staged = Promise.race([reached, saved.then(() => { throw new Error("Missing stage barrier"); })]);
  let enqueued = () => {};
  const queued = new Promise<void>(resolve => { enqueued = resolve; });
  const writerEnv = { ...env, onAccessQueued: enqueued };
  let edited: Promise<unknown> | undefined;
  try {
    await staged;
    edited = writer === "token"
      ? upsertDesignSystemColorToken(id, { name: "concurrent", value: "#654321" }, writerEnv)
      : uploadDesignSystemFont({ systemId: id, file: new File([figtree], "concurrent.woff2"), family: "Concurrent", role: "sans" }, writerEnv);
    await Promise.race([queued, edited.then(() => { throw new Error("Writer bypassed shared access"); })]);
    expect(getCurrentSystemContent(getSqlite(), id)).toBeNull();
  } finally { release(); }
  await Promise.all([saved, edited]);
  expect((await readDesignSystemPalette(id, paletteEnv)).state).toEqual(createDefaultPalette());
  expect(await readFile(tokenPath, "utf8")).toContain(writer === "token" ? "--concurrent: #654321;" : "Concurrent");
  if (writer === "font") expect(await readFile(path.join(root, "fonts/concurrent.woff2"))).toEqual(figtree);
  const receipts = listSystemContentReceipts(getSqlite()).filter(receipt => receipt.designSystemId === id);
  expect(receipts.map(receipt => receipt.contentRevision)).toEqual([1, 2]);
  const receipt = getCurrentSystemContent(getSqlite(), id);
  if (receipt === null) throw new Error("Missing concurrent receipt");
  await validateCatalogReceiptTree(root, receipt);
});

test("R2-3: Given a literal stack whose quoted first family matches the upload When the same family is uploaded again Then the family appears once at the front of the stack", async () => {
  await writeFile(tokenPath, ':root {\n  --font-sans: "Inter", "Pretendard", sans-serif;\n}\n', "utf8");
  await writeFile(fontsCssPath, "", "utf8");
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "inter.woff2"), family: "Inter", role: "sans" });
  const tokens = await readFile(tokenPath, "utf8");
  const line = tokens.split("\n").find((entry) => entry.includes("--font-sans:")) ?? "";
  expect(line).toMatch(/--font-sans:\s*Inter, "Pretendard", sans-serif;/);
  expect(line.match(/Inter/g)?.length).toBe(1);
});

test("F-DATA-4: Given a token file that cannot be read When a color is saved or a font is uploaded Then a typed error is thrown and no file is written", async () => {
  await writeFile(fontsCssPath, "/* before */\n", "utf8");
  const fontsDir = path.dirname(fontsCssPath);
  const before = { tokens: await readFile(tokenPath, "utf8"), fontsCss: await readFile(fontsCssPath, "utf8"), files: (await readdir(fontsDir)).sort() };
  const original = fsp.readFile;
  const read = spyOn(fsp, "readFile").mockImplementation((async (...args: Parameters<typeof fsp.readFile>) => {
    if (args[0] !== tokenPath) return original(...args);
    throw Object.assign(new Error("permission denied"), { code: "EACCES", path: tokenPath });
  }) as typeof fsp.readFile);
  try {
    await expect(upsertDesignSystemColorToken(id, { name: "accent", value: "#123456" })).rejects.toMatchObject({ code: "token_file_unreadable" });
    await expect(uploadDesignSystemFont({ systemId: id, file: new File([figtree], "unreadable.woff2"), family: "Unreadable", role: "sans" })).rejects.toMatchObject({ code: "token_file_unreadable" });
  } finally { read.mockRestore(); }
  expect(await readFile(tokenPath, "utf8")).toBe(before.tokens);
  expect(await readFile(fontsCssPath, "utf8")).toBe(before.fontsCss);
  expect((await readdir(fontsDir)).sort()).toEqual(before.files);
});

test("Given another tree file denies reads When a color is saved Then it is not mislabeled as unreadable token CSS", async () => {
  const deniedPath = path.join(path.dirname(tokenPath), "README.md");
  await writeFile(deniedPath, "READ_ACCESS_CONTROL", "utf8");
  const before = await readFile(tokenPath, "utf8");
  const denied = Object.assign(new Error("READ_ACCESS_CONTROL"), { code: "EACCES", path: deniedPath });
  const original = fsp.readFile;
  const read = spyOn(fsp, "readFile").mockImplementation((async (...args: Parameters<typeof fsp.readFile>) => {
    if (args[0] === deniedPath) throw denied;
    return original(...args);
  }) as typeof fsp.readFile);
  try {
    await expect(upsertDesignSystemColorToken(id, { name: "accent", value: "#123456" })).rejects.toBe(denied);
  } finally { read.mockRestore(); }
  expect(await readFile(tokenPath, "utf8")).toBe(before);
});

test("F-DATA-4: Given a color edit and a font upload When both rewrite CSS files Then the results are complete and no temp files remain", async () => {
  await writeFile(tokenPath, ":root {\n  --primary-blue: #0057B8;\n}\n", "utf8");
  await upsertDesignSystemColorToken(id, { name: "accent", value: "#123456" });
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "atomic.woff2"), family: "Atomic", role: "sans" });
  const tokens = await readFile(tokenPath, "utf8");
  expect(tokens).toContain("--primary-blue: #0057B8;");
  expect(tokens).toContain("--accent: #123456;");
  expect(await readFile(fontsCssPath, "utf8")).toContain("url('./atomic.woff2')");
  const leftovers = [...(await readdir(root)), ...(await readdir(path.dirname(fontsCssPath)))].filter((name) => name.endsWith(".tmp"));
  expect(leftovers).toEqual([]);
});
