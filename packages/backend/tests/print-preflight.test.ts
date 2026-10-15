import { describe, expect, test } from "bun:test";
import path from "node:path";
import { PRINT_PPI_STRONG_WARN } from "@bg/shared/print-preflight";
import { extractFontFaceRefs, resolveFonts, summarizeImages, summarizePages, type ImageMeasurement, type PageMeasurement } from "../src/services/print-preflight";

// Synthetic A4 multi-artboard fixture: A4 is 210 x 297 mm, 793.7 x 1122.5 CSS px at 96 dpi.
const A4_WIDTH_PX = 793.7;
const A4_HEIGHT_PX = 1122.5;
const PAGES: readonly PageMeasurement[] = [
  { name: "Cover", width: A4_WIDTH_PX, height: A4_HEIGHT_PX },
  { name: "Story", width: A4_WIDTH_PX, height: A4_HEIGHT_PX },
  { name: "Back", width: A4_WIDTH_PX, height: A4_HEIGHT_PX },
];
const fullWidthImage = (pageIndex: number, naturalWidth: number): ImageMeasurement => ({
  pageIndex, locator: `[data-graphic-artboard]:nth-of-type(${pageIndex + 1}) img.hero`, naturalWidth, naturalHeight: Math.round(naturalWidth * 1.414),
  displayWidth: A4_WIDTH_PX, displayHeight: A4_HEIGHT_PX, visibleWidthFraction: 1, visibleHeightFraction: 1,
});
const CSS = `@font-face { font-family: "Brand Sans"; src: url("fonts/BrandSans.woff2") format("woff2"), url(fonts/BrandSans.woff) format("woff"); }
@font-face { font-family: 'Quiet Serif'; src: url('fonts\\QuietSerif.woff2'); }`;

describe("print preflight", () => {
  test("Given three A4 artboards, When pages are summarised, Then each reports millimetres and pixels", () => {
    const pages = summarizePages(PAGES);
    expect(pages.map((page) => page.index)).toEqual([1, 2, 3]);
    expect(pages[0]).toMatchObject({ name: "Cover", width_mm: 210, height_mm: 297, width_px: 793.7, height_px: 1122.5 });
  });

  test("Given a 600px image across the A4 width, When images are summarised, Then it is a strong warning naming page 2", () => {
    const images = summarizeImages(PAGES, [fullWidthImage(1, 600)]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ page: 2, page_name: "Story", intrinsic_width_px: 600, severity: "strong_warn" });
    expect(images[0]?.effective_ppi).toBeLessThan(PRINT_PPI_STRONG_WARN);
    expect(images[0]?.locator).toContain("img.hero");
  });

  test("Given an image that is cropped to half its width, When images are summarised, Then the crop lowers the effective ppi", () => {
    const cropped = { ...fullWidthImage(0, 3000), visibleWidthFraction: 0.5, visibleHeightFraction: 1 };
    const [uncropped] = summarizeImages(PAGES, [fullWidthImage(0, 3000)]);
    const [result] = summarizeImages(PAGES, [cropped]);
    expect(uncropped?.severity).toBe("ok");
    expect(result?.effective_ppi).toBeLessThan((uncropped?.effective_ppi ?? 0) * 0.6);
  });

  test("Given an image with enough pixels for print, When images are summarised, Then it carries no warning", () => {
    const flagged = summarizeImages(PAGES, [fullWidthImage(0, 3000)]).filter((image) => image.severity !== "ok");
    expect(flagged).toEqual([]);
  });

  test("Given an image between 150 and 300 ppi, When images are summarised, Then it is a plain warning", () => {
    const [image] = summarizeImages(PAGES, [fullWidthImage(0, 1800)]);
    expect(image?.severity).toBe("warn");
  });

  test("Given an unloaded image with zero natural size, When images are summarised, Then it is left out rather than scored", () => {
    expect(summarizeImages(PAGES, [fullWidthImage(0, 0)])).toEqual([]);
  });

  test("Given a stylesheet with two faces, When references are extracted, Then family and every url come back unquoted", () => {
    const refs = extractFontFaceRefs(CSS, "styles");
    expect(refs).toEqual([
      { family: "Brand Sans", urls: ["fonts/BrandSans.woff2", "fonts/BrandSans.woff"], baseDir: "styles" },
      { family: "Quiet Serif", urls: ["fonts\\QuietSerif.woff2"], baseDir: "styles" },
    ]);
  });

  const flavors = [
    { label: "POSIX", flavor: path.posix, root: "/work/project" },
    { label: "Windows", flavor: path.win32, root: "C:\\work\\project" },
  ] as const;
  for (const { label, flavor, root } of flavors) {
    test(`Given a ${label} project root, When one font file is missing, Then it is listed by project-relative path and the present one is resolved`, async () => {
      const present = flavor.join(root, "styles", "fonts", "BrandSans.woff2");
      const files = new Set([present]);
      const fonts = await resolveFonts({
        projectRoot: root,
        refs: extractFontFaceRefs(CSS, "styles"),
        flavor,
        exists: async (absolute) => files.has(absolute),
        listDir: async () => ["OFL.txt", "BrandSans.woff2"],
      });
      expect(fonts).toContainEqual({ family: "Brand Sans", status: "resolved", path: "styles/fonts/BrandSans.woff2", license_present: true });
      expect(fonts).toContainEqual({ family: "Quiet Serif", status: "missing", path: "styles/fonts/QuietSerif.woff2", license_present: false });
    });
  }

  test("Given absolute, escaping and remote references, When fonts are resolved, Then none leaks an absolute path and remote is flagged", async () => {
    const fonts = await resolveFonts({
      projectRoot: "/work/project",
      refs: [
        { family: "Abs", urls: ["C:\\Users\\someone\\Abs.ttf"], baseDir: "" },
        { family: "Up", urls: ["../../outside/Up.woff2"], baseDir: "styles" },
        { family: "Cdn", urls: ["https://fonts.example/Cdn.woff2"], baseDir: "" },
      ],
      flavor: path.posix,
      exists: async () => true,
      listDir: async () => [],
    });
    expect(fonts).toEqual([
      { family: "Abs", status: "missing", path: "Abs.ttf", license_present: false },
      { family: "Up", status: "missing", path: "Up.woff2", license_present: false },
      { family: "Cdn", status: "remote", path: null, license_present: false },
    ]);
  });
});
