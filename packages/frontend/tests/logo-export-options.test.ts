import { describe, expect, test } from "bun:test";
import {
  buildExportMenuModel,
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
      .toEqual([["cafe24_package", "web_only"], ["imweb_package", "web_only"]]);
    expect(model.options.some((option) => option.format === "png" || option.format === "pptx" || option.format === "png_zip")).toBe(false);
  });
});
