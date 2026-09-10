import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EXPORT_OPTION_VALUES,
  buildExportMenuModel,
  buildExportRetryRequest,
  cafe24AssetBaseUrl,
  type ExportMenuModel,
  type ExportMenuOption,
} from "../src/components/export/export-options";

function options(model: ExportMenuModel): readonly ExportMenuOption[] {
  if (!model.ok) throw new TypeError("expected an available export model");
  return model.options;
}

function entry(model: ExportMenuModel, key: string): ExportMenuOption {
  const found = options(model).find((option) => option.key === key);
  if (found === undefined) throw new TypeError(`missing export option: ${key}`);
  return found;
}

function graphicOptionsJson(set: Record<string, unknown> | null, height = 1350): string {
  return JSON.stringify({
    graphic_canvas: { schema_version: 1, width: 1080, height },
    ...(set === null ? {} : { graphic_set: set }),
  });
}

describe("platform package export choices", () => {
  test.each(["prototype", "from_template", "other"] as const)(
    "Given a web project When the menu is modeled Then both platform packages are choosable",
    (projectType) => {
      const model = buildExportMenuModel(projectType, null, DEFAULT_EXPORT_OPTION_VALUES);

      expect(entry(model, "cafe24_package").disabledReason).toBeUndefined();
      expect(entry(model, "cafe24_package").label).toBe("카페24 스마트디자인 패키지");
      expect(entry(model, "imweb_package").disabledReason).toBeUndefined();
      expect(entry(model, "imweb_package").label).toBe("아임웹 코드위젯 패키지");
    },
  );

  test("Given a slide deck When the menu is modeled Then platform packages are disabled as web-only", () => {
    const model = buildExportMenuModel("slide_deck", null, DEFAULT_EXPORT_OPTION_VALUES);

    expect(entry(model, "cafe24_package").disabledReason).toBe("web_only");
    expect(entry(model, "imweb_package").disabledReason).toBe("web_only");
  });

  test("Given a graphic project When the menu is modeled Then platform packages are disabled as web-only", () => {
    const model = buildExportMenuModel("graphic", graphicOptionsJson(null), DEFAULT_EXPORT_OPTION_VALUES);

    expect(entry(model, "cafe24_package").disabledReason).toBe("web_only");
  });

  test("Given a Cafe24 package with no entered URL When the menu is modeled Then the prefilled shop path is sent", () => {
    const model = buildExportMenuModel("prototype", null, DEFAULT_EXPORT_OPTION_VALUES);

    expect(entry(model, "cafe24_package").options).toEqual({
      asset_base_url: cafe24AssetBaseUrl(""),
    });
    expect(cafe24AssetBaseUrl("shop-notice")).toBe("/web/upload/burnguard/shop-notice/");
  });

  test("Given an entered asset base URL When the menu is modeled Then both packages carry it", () => {
    const model = buildExportMenuModel("prototype", null, {
      ...DEFAULT_EXPORT_OPTION_VALUES,
      assetBaseUrl: "https://cdn.example.com/burnguard/",
    });

    expect(entry(model, "cafe24_package").options).toEqual({ asset_base_url: "https://cdn.example.com/burnguard/" });
    expect(entry(model, "imweb_package").options).toEqual({ asset_base_url: "https://cdn.example.com/burnguard/" });
  });

  test("Given an Imweb package When the menu is modeled Then the board-attach helper text is offered as a field", () => {
    const model = buildExportMenuModel("prototype", null, DEFAULT_EXPORT_OPTION_VALUES);

    const fields = entry(model, "imweb_package").fields ?? [];
    expect(fields.map((field) => field.kind)).toEqual(["asset_base_url"]);
    expect(fields[0]?.hint).toContain("게시판");
  });
});

describe("png_zip availability", () => {
  test("Given a slide deck When the menu is modeled Then the frame ZIP is choosable", () => {
    const model = buildExportMenuModel("slide_deck", null, DEFAULT_EXPORT_OPTION_VALUES);

    expect(entry(model, "png_zip").disabledReason).toBeUndefined();
    expect(entry(model, "png_zip").label).toBe("PNG 묶음 (ZIP)");
  });

  test("Given a web project When the menu is modeled Then the frame ZIP is disabled as frames-only", () => {
    const model = buildExportMenuModel("prototype", null, DEFAULT_EXPORT_OPTION_VALUES);

    expect(entry(model, "png_zip").disabledReason).toBe("frames_only");
  });

  test("Given a multi-frame card news set When the menu is modeled Then the frame ZIP is choosable", () => {
    const model = buildExportMenuModel(
      "graphic",
      graphicOptionsJson({ schema_version: 1, kind: "card_news", frame_count: 6 }),
      DEFAULT_EXPORT_OPTION_VALUES,
    );

    expect(entry(model, "png_zip").disabledReason).toBeUndefined();
    expect(entry(model, "png_zip").options).toBeUndefined();
  });

  test("Given a single-frame thumbnail set When the menu is modeled Then only the single PNG is choosable", () => {
    const model = buildExportMenuModel(
      "graphic",
      graphicOptionsJson({ schema_version: 1, kind: "single", frame_count: 1 }),
      DEFAULT_EXPORT_OPTION_VALUES,
    );

    expect(entry(model, "graphic-png").options).toEqual({ png_width: 1080, png_height: 1350, png_dpr: 1 });
    expect(options(model).some((option) => option.format === "png_zip")).toBe(false);
  });
});

describe("product detail slice options", () => {
  test("Given a product detail set When JPEG slices are chosen Then quality rides along", () => {
    const model = buildExportMenuModel(
      "graphic",
      graphicOptionsJson({ schema_version: 1, kind: "product_detail", frame_count: 1 }, 12_000),
      { ...DEFAULT_EXPORT_OPTION_VALUES, sliceHeight: 3000, sliceFormat: "jpeg", jpegQuality: 70 },
    );

    expect(entry(model, "png_zip").options).toEqual({
      slice_height: 3000,
      slice_format: "jpeg",
      jpeg_quality: 70,
    });
    expect((entry(model, "png_zip").fields ?? []).map((field) => field.kind)).toEqual(["slice"]);
  });

  test("Given a card news set When the frame ZIP is modeled Then no JPEG quality is sent", () => {
    const model = buildExportMenuModel(
      "graphic",
      graphicOptionsJson({ schema_version: 1, kind: "card_news", frame_count: 6 }),
      { ...DEFAULT_EXPORT_OPTION_VALUES, sliceFormat: "jpeg", jpegQuality: 70 },
    );

    expect(entry(model, "png_zip").options).toBeUndefined();
    expect(entry(model, "png_zip").fields).toBeUndefined();
  });
});

describe("artboard PDF availability", () => {
  test("Given a uniform card news set When the menu is modeled Then the artboard PDF is choosable", () => {
    const model = buildExportMenuModel(
      "graphic",
      graphicOptionsJson({ schema_version: 1, kind: "card_news", frame_count: 6 }),
      DEFAULT_EXPORT_OPTION_VALUES,
    );

    const pdf = entry(model, "graphic-pdf-artboard");
    expect(pdf.disabledReason).toBeUndefined();
    expect(pdf.options).toEqual({ pdf_paper: "artboard" });
  });

  test("Given a banner set with mixed frame sizes When the menu is modeled Then the artboard PDF is disabled and explained", () => {
    const model = buildExportMenuModel(
      "graphic",
      graphicOptionsJson({
        schema_version: 1,
        kind: "banner_set",
        frame_count: 2,
        frames: [
          { width: 1080, height: 1080, label: "정사각형" },
          { width: 1200, height: 628, label: "가로형" },
        ],
      }),
      DEFAULT_EXPORT_OPTION_VALUES,
    );

    const pdf = entry(model, "graphic-pdf-artboard");
    expect(pdf.disabledReason).toBe("mixed_frames");
    expect(pdf.note).toContain("PNG 묶음");
    expect(entry(model, "png_zip").disabledReason).toBeUndefined();
  });
});

describe("retry keeps the chosen options", () => {
  test("Given a Cafe24 package job When retried Then the entered asset base URL is carried unchanged", () => {
    const values = { ...DEFAULT_EXPORT_OPTION_VALUES, assetBaseUrl: "/web/upload/burnguard/spring/" };
    const model = buildExportMenuModel("prototype", null, values);

    expect(buildExportRetryRequest("prototype", "cafe24_package", model)).toEqual({
      format: "cafe24_package",
      options: { asset_base_url: "/web/upload/burnguard/spring/" },
    });
  });

  test("Given a JPEG slice job When retried Then the slice options are carried unchanged", () => {
    const model = buildExportMenuModel(
      "graphic",
      graphicOptionsJson({ schema_version: 1, kind: "product_detail", frame_count: 1 }, 12_000),
      { ...DEFAULT_EXPORT_OPTION_VALUES, sliceHeight: 3000, sliceFormat: "jpeg", jpegQuality: 90 },
    );

    expect(buildExportRetryRequest("graphic", "png_zip", model)).toEqual({
      format: "png_zip",
      options: { slice_height: 3000, slice_format: "jpeg", jpeg_quality: 90 },
    });
  });
});
