import { describe, expect, test } from "bun:test";
import {
  buildExportMenuModel,
  classifyChromiumFailure,
  CHROMIUM_FAILURE_MESSAGE,
} from "../src/components/export/export-options";

describe("graphic export menu model", () => {
  test("Given persisted graphic dimensions When modeled Then only exact DPR1 PNG is exposed", () => {
    const model = buildExportMenuModel("graphic", JSON.stringify({
      use_speaker_notes: false,
      copy_as_is: false,
      design_brief: null,
      graphic_canvas: { schema_version: 1, width: 1200, height: 628 },
    }));

    expect(model.ok).toBe(true);
    expect(model.options.filter((option) => option.format === "png")).toEqual([{
      key: "graphic-png",
      format: "png",
      options: { png_width: 1200, png_height: 628, png_dpr: 1 },
      label: "PNG · 1200×628",
    }]);
    expect(model.options.filter((option) => option.disabledReason === undefined).map((option) => option.format))
      .toEqual(["png", "pdf"]);
  });

  test.each([null, "{", JSON.stringify({ graphic_canvas: null })])(
    "Given missing or malformed persisted dimensions When modeled Then no wrong-size action is exposed",
    (optionsJson) => {
      const model = buildExportMenuModel("graphic", optionsJson);
      expect(model.ok).toBe(false);
      if (model.ok) throw new TypeError("expected invalid graphic export model");
      expect(model.options).toEqual([]);
    },
  );

  test("Given a non-graphic project When modeled Then existing actions remain available", () => {
    const model = buildExportMenuModel("prototype", null);
    expect(model.ok).toBe(true);
    if (!model.ok) throw new TypeError("expected normal export model");
    expect(model.options.filter((option) => option.disabledReason === undefined).map((option) => option.format)).toEqual(["html_zip", "handoff", "cafe24_package", "imweb_package"]);
    expect(model.options.filter((option) => option.disabledReason === "deck_only").map((option) => option.format)).toEqual(["pdf", "pdf", "pdf", "pptx", "pptx"]);
    expect(model.options.filter((option) => option.disabledReason === "frames_only").map((option) => option.format)).toEqual(["png_zip"]);
  });
});

describe("graphic artboard PDF raster budget", () => {
  const artboardPdf = (canvas: { readonly width: number; readonly height: number }, graphicSet: Readonly<Record<string, unknown>>) => {
    const model = buildExportMenuModel("graphic", JSON.stringify({ graphic_canvas: { schema_version: 1, ...canvas }, graphic_set: { schema_version: 1, ...graphicSet } }));
    if (!model.ok) throw new TypeError("expected graphic export model");
    return model.options.find((option) => option.key === "graphic-pdf-artboard");
  };

  test.each([
    { preset_id: "smartstore-product-detail", width: 860, height: 16_000 },
    { preset_id: "coupang-product-detail", width: 780, height: 16_000 },
  ])("Given a $preset_id graphic When the menu is modeled Then the artboard PDF entry is disabled as too large", ({ preset_id, width, height }) => {
    expect(artboardPdf({ width, height }, { kind: "product_detail", frame_count: 1, preset_id })?.disabledReason).toBe("pdf_too_large");
  });

  test("Given six 1080x1350 card news frames When the menu is modeled Then the artboard PDF entry stays enabled", () => {
    expect(artboardPdf({ width: 1080, height: 1350 }, { kind: "card_news", frame_count: 6 })).toMatchObject({ format: "pdf", options: { pdf_paper: "artboard" } });
    expect(artboardPdf({ width: 1080, height: 1350 }, { kind: "card_news", frame_count: 6 })?.disabledReason).toBeUndefined();
  });

  test("Given twenty 1080x1350 card news frames When the menu is modeled Then the aggregate budget disables the artboard PDF entry", () => {
    expect(artboardPdf({ width: 1080, height: 1350 }, { kind: "card_news", frame_count: 20 })?.disabledReason).toBe("pdf_too_large");
  });

  test("Given banner frames of one size When the menu is modeled Then the budget counts the banner frames, not the canvas", () => {
    const frames = Array.from({ length: 2 }, () => ({ width: 4000, height: 4000, label: "Poster" }));
    expect(artboardPdf({ width: 1080, height: 1080 }, { kind: "banner_set", frame_count: 2, frames })?.disabledReason).toBe("pdf_too_large");
  });
});

describe("chromium export failure copy", () => {
  test("Given a launch timeout message When classified Then safe retry guidance is offered", () => {
    expect(classifyChromiumFailure("chromium_launch_timeout: Chromium did not finish launching\ntried channels: bundled, chrome, msedge")).toBe("launch_timeout");
    expect(CHROMIUM_FAILURE_MESSAGE.launch_timeout).toBe("Chromium 렌더링을 완료하지 못했어요. 설정에서 Chromium 상태를 확인한 뒤 다시 시도해 주세요.");
  });

  test("Given a missing browser When classified Then the install guidance covers the code and the older message", () => {
    expect(classifyChromiumFailure("chromium_not_installed: Chromium could not be launched")).toBe("not_installed");
    expect(classifyChromiumFailure("Executable doesn't exist at ms-playwright/chromium-1200/chrome.exe")).toBe("not_installed");
    expect(CHROMIUM_FAILURE_MESSAGE.not_installed).toContain("설정");
  });

  test("Given an unrelated failure When classified Then the raw message is left to the caller", () => {
    expect(classifyChromiumFailure("Design audit found 3 must-fix findings")).toBeNull();
    expect(classifyChromiumFailure(null)).toBeNull();
  });
});
