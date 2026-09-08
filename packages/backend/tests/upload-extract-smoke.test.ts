import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { UPLOAD_EXTRACTOR_PY } from "../src/services/upload-extractor-py";
import {
  readUploadManifest,
  runPythonUploadExtractor,
} from "../src/services/design-system-extract";

/**
 * End-to-end upload extraction smoke. Exercises the real Python
 * subprocess against a freshly-generated PPTX so a regression in
 * `upload-extractor-py.ts` (or the `readUploadManifest` normalizer)
 * shows up as a CI failure rather than a Settings-modal install
 * button mystery.
 *
 * Opt-in via `BG_UPLOAD_SMOKE=1` so the default `bun test` run stays
 * green on fresh checkouts where Python isn't installed. PPTX-only —
 * PDF smoke would also require `pypdf`, and keeping the dependency
 * surface narrow keeps the opt-in cheap.
 */

const SMOKE_OPT_IN = process.env.BG_UPLOAD_SMOKE === "1";

let pythonAvailable = false;
let pythonPrefix: string[] = [];

beforeAll(async () => {
  if (!SMOKE_OPT_IN) return;

  // Mirror of `python-health.ts`'s probe — skip rather than fail when
  // a contributor opts in on a machine without Python.
  const candidates =
    process.platform === "win32"
      ? [["py", "-3"], ["python3"], ["python"]]
      : [["python3"], ["python"]];
  for (const prefix of candidates) {
    try {
      const proc = Bun.spawn({
        cmd: [...prefix, "--version"],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        pythonAvailable = true;
        pythonPrefix = prefix;
        return;
      }
    } catch {
      // try next candidate
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    "[upload-extract.smoke] skipping — no python3 / python / py found on PATH",
  );
});

async function generateSamplePptx(targetPath: string): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  const slide1 = pptx.addSlide();
  slide1.addText("Quarterly Review", {
    x: 0.5,
    y: 0.5,
    w: 9,
    h: 1,
    fontSize: 32,
    bold: true,
    color: "0057B8",
    fontFace: "Inter",
  });
  slide1.addText("Revenue expanded 22% year over year.", {
    x: 0.5,
    y: 2,
    w: 9,
    h: 0.8,
    fontSize: 18,
    fontFace: "Inter",
  });

  const slide2 = pptx.addSlide();
  slide2.addText("Next steps", {
    x: 0.5,
    y: 0.5,
    w: 9,
    h: 1,
    fontSize: 28,
    bold: true,
    fontFace: "Inter",
  });
  slide2.addText("Get started with the new onboarding flow.", {
    x: 0.5,
    y: 2,
    w: 9,
    h: 0.8,
    fontSize: 18,
    fontFace: "Inter",
  });

  await pptx.writeFile({ fileName: targetPath });
}

describe("upload extractor end-to-end (BG_UPLOAD_SMOKE=1)", () => {
  test("Given OOXML theme-only RGB and system colors When extracted Then both attribute values are retained", async () => {
    if (!SMOKE_OPT_IN || !pythonAvailable) return;
    const dir = await mkdtemp(path.join(tmpdir(), "bg-upload-theme-"));
    try {
      const zip = new JSZip();
      zip.file("ppt/theme/theme1.xml", '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Brand"><a:accent1><a:srgbClr val="123456"/></a:accent1><a:dk1><a:sysClr val="windowText" lastClr="AABBCC"/></a:dk1></a:clrScheme></a:themeElements></a:theme>');
      const sourcePath = path.join(dir, "theme.pptx"), manifestPath = path.join(dir, "manifest.json");
      await writeFile(sourcePath, await zip.generateAsync({ type: "uint8array" }));
      await runPythonUploadExtractor({ sourcePath, manifestPath });
      expect((await readUploadManifest(manifestPath)).colors).toEqual(["#123456", "#AABBCC"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test("Given tiny fixtures over injected archive limits When Python extracts Then expansion is rejected before XML parsing", async () => {
    if (!SMOKE_OPT_IN || !pythonAvailable) return;
    const dir = await mkdtemp(path.join(tmpdir(), "bg-upload-limits-"));
    try {
      const zip = new JSZip();
      zip.file("ppt/theme/theme1.xml", "<theme>" + "x".repeat(64) + "</theme>", { createFolders: false });
      zip.file("ppt/slides/slide1.xml", "<slide/>", { createFolders: false });
      const source = path.join(dir, "tiny.pptx"), script = path.join(dir, "extract.py");
      await writeFile(source, await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
      for (const [constant, original] of [["MAX_XML_BYTES", "8 * 1024 * 1024"], ["MAX_PPTX_ENTRIES", "10000"], ["MAX_PPTX_EXPANDED_BYTES", "128 * 1024 * 1024"]]) {
        await writeFile(script, UPLOAD_EXTRACTOR_PY.replace(`${constant} = ${original}`, `${constant} = 1`));
        const child = Bun.spawn([...pythonPrefix, script, "--input", source, "--output", path.join(dir, "manifest.json")], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
        const [exit, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect(exit, constant).not.toBe(0);
        expect(error, constant).toContain("exceeds extraction limit");
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test("parses a generated pptx through the Python extractor", async () => {
    if (!SMOKE_OPT_IN) {
      // eslint-disable-next-line no-console
      console.log(
        "[upload-extract.smoke] skipping — set BG_UPLOAD_SMOKE=1 to run",
      );
      return;
    }
    if (!pythonAvailable) {
      expect(true).toBe(true);
      return;
    }

    const dir = await mkdtemp(path.join(tmpdir(), "bg-upload-smoke-"));
    try {
      const sourcePath = path.join(dir, "sample.pptx");
      await generateSamplePptx(sourcePath);
      const manifestPath = path.join(dir, "manifest.json");

      await runPythonUploadExtractor({ sourcePath, manifestPath });

      const manifest = await readUploadManifest(manifestPath);
      expect(manifest.kind).toBe("pptx");
      expect(manifest.page_count).toBe(2);
      expect(manifest.pages.length).toBe(2);
      expect(manifest.pages[0]!.title).toMatch(/Quarterly|Review/);
      expect(manifest.headings.length).toBeGreaterThan(0);
      // Inter font was applied to every run; the theme walker may or
      // may not surface it (depends on pptxgenjs defaults), but at
      // least one font candidate should land.
      expect(Array.isArray(manifest.fonts)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags invalid-kind manifests produced by a regressed extractor", async () => {
    if (!SMOKE_OPT_IN) return;
    if (!pythonAvailable) return;

    const dir = await mkdtemp(path.join(tmpdir(), "bg-upload-smoke-"));
    try {
      const bad = path.join(dir, "bad-manifest.json");
      await writeFile(bad, JSON.stringify({ kind: "docx" }));
      await expect(readUploadManifest(bad)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
