import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { persistCanonicalExtraction, uploadDesignSystemFont } from "../src/services/design-system-extract";
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
