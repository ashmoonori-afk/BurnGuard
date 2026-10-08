import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { persistCanonicalExtraction, uploadDesignSystemFont, upsertDesignSystemColorToken } from "../src/services/design-system-extract";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";

const id = `font-upload-${process.pid}`;
const root = path.join(systemsDir, id);
const tokenPath = path.join(root, "colors_and_type.css");
const fontsCssPath = path.join(root, "fonts", "fonts.css");
let figtree: Buffer;

beforeAll(async () => {
  figtree = await readFile(path.resolve(import.meta.dir, "../../../assets/fonts/Figtree.woff2"));
  const source = await mkdtemp(path.join(tmpdir(), "bg-font-upload-source-"));
  try {
    const analysis = await analyzeLocalTree(source, "Font fixture", new AbortController().signal);
    await persistCanonicalExtraction({ requestedId: id, brandName: "Font fixture", sourceType: "upload", sourceReference: "fixture.pdf", lineage: null, analysis, signal: new AbortController().signal });
  } finally { await rm(source, { recursive: true, force: true }); }
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
  await rm(root, { recursive: true, force: true });
});

test("CSS-14: Given an extracted system whose fonts.css defines the role fallback When a font is uploaded Then the token keeps referencing the fallback variable", async () => {
  await uploadDesignSystemFont({ systemId: id, file: new File([figtree], "extracted-sans.woff2"), family: "Extracted Sans", role: "sans" });
  const tokens = await readFile(tokenPath, "utf8");
  expect(tokens).toMatch(/--font-sans:\s*"Extracted Sans", var\(--font-sans-fallback\);/);
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
  const fontsCss = await readFile(fontsCssPath, "utf8");
  const rule = fontsCss.slice(fontsCss.indexOf("url('./brand-mono.woff2')"));
  expect(rule).toMatch(/font-weight:\s*400;/);
  expect(fontsCss).not.toContain("font-weight: 100 900");
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

test("F-DATA-4: Given a token file that cannot be read When a color is saved Then a typed error is thrown and nothing is rewritten", async () => {
  const saved = await readFile(tokenPath, "utf8");
  await rm(tokenPath);
  await mkdir(tokenPath);
  try {
    await expect(upsertDesignSystemColorToken(id, { name: "accent", value: "#123456" })).rejects.toMatchObject({ code: "token_file_unreadable" });
    await expect(uploadDesignSystemFont({ systemId: id, file: new File([figtree], "unreadable.woff2"), family: "Unreadable", role: "sans" })).rejects.toMatchObject({ code: "token_file_unreadable" });
  } finally {
    await rm(tokenPath, { recursive: true, force: true });
    await writeFile(tokenPath, saved, "utf8");
  }
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
