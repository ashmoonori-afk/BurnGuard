import { describe, expect, test } from "bun:test";
import {
  buildExportMenuModel,
  classifyConstructionFailure,
  DEFAULT_EXPORT_OPTION_VALUES,
  EXPORT_DISABLED_LABEL,
} from "../src/components/export/export-options";

describe("logo export menu model", () => {
  test("Given a logo project When modeled Then exactly the logo deliverables are offered", () => {
    const model = buildExportMenuModel("logo", JSON.stringify({ logo_set: { schema_version: 1 } }));

    expect(model.ok).toBe(true);
    if (!model.ok) throw new TypeError("expected a logo export model");
    expect(model.options.filter((option) => option.disabledReason === undefined)).toEqual([
      { key: "logo-svg", format: "svg", options: {}, label: "로고 SVG" },
      { key: "guidelines-pdf", format: "pdf", options: { pdf_paper: "artboard" }, label: "가이드라인 PDF" },
      { key: "guidelines-html", format: "html_zip", options: {}, label: "가이드라인 HTML (ZIP)" },
    ]);
  });

  test("Given a logo project When modeled Then platform packages stay disabled as web-only", () => {
    const model = buildExportMenuModel("logo", null);

    expect(model.ok).toBe(true);
    if (!model.ok) throw new TypeError("expected a logo export model");
    expect(model.options.filter((option) => option.disabledReason !== undefined).map((option) => [option.format, option.disabledReason]))
      .toEqual([
        ["construction_svg", "construction_missing"],
        ["construction_gif", "construction_missing"],
        ["construction_mp4", "construction_missing"],
        ["cafe24_package", "web_only"],
        ["imweb_package", "web_only"],
      ]);
    expect(model.options.some((option) => option.format === "png" || option.format === "pptx" || option.format === "png_zip")).toBe(false);
  });
});

describe("logo construction export entries (doc/37)", () => {
  test("Given a logo with its construction record When modeled Then the sheet, the draw-in GIF and the draw-in MP4 are offered", () => {
    const model = buildExportMenuModel("logo", null, DEFAULT_EXPORT_OPTION_VALUES, true);

    expect(model.ok).toBe(true);
    if (!model.ok) throw new TypeError("expected a logo export model");
    const construction = model.options.filter((option) => option.format.startsWith("construction_"));
    expect(construction.map((option) => [option.key, option.format, option.options, option.disabledReason]))
      .toEqual([["construction-svg", "construction_svg", {}, undefined], ["construction-gif", "construction_gif", {}, undefined], ["construction-mp4", "construction_mp4", {}, undefined]]);
  });

  test("Given a logo without a construction record When modeled Then every construction entry stays listed with its own disabled reason", () => {
    const model = buildExportMenuModel("logo", null, DEFAULT_EXPORT_OPTION_VALUES, false);

    expect(model.ok).toBe(true);
    if (!model.ok) throw new TypeError("expected a logo export model");
    const disabled = model.options.filter((option) => option.disabledReason === "construction_missing").map((option) => option.key);
    expect(disabled).toEqual(["construction-svg", "construction-gif", "construction-mp4"]);
    expect(EXPORT_DISABLED_LABEL.construction_missing).not.toBe(EXPORT_DISABLED_LABEL.web_only);
  });

  test("Given a web project with a construction record When modeled Then no construction entry appears", () => {
    const model = buildExportMenuModel("prototype", null, DEFAULT_EXPORT_OPTION_VALUES, true);

    expect(model.ok).toBe(true);
    if (!model.ok) throw new TypeError("expected a web export model");
    expect(model.options.some((option) => option.format.startsWith("construction_"))).toBe(false);
  });

  test("Given persisted failure messages When classified Then each construction code maps to its own failure and others to none", () => {
    expect(classifyConstructionFailure("Export failed: construction_missing")).toBe("missing");
    expect(classifyConstructionFailure("Export failed: construction_invalid")).toBe("invalid");
    expect(classifyConstructionFailure("Export failed: construction_too_large")).toBe("too_large");
    expect(classifyConstructionFailure("Export failed: construction_mp4_unsupported: avc1.42001e")).toBe("mp4_unsupported");
    expect(classifyConstructionFailure("Export failed: render_failed_raster")).toBeNull();
    expect(classifyConstructionFailure("Export failed")).toBeNull();
    expect(classifyConstructionFailure(null)).toBeNull();
  });
});
