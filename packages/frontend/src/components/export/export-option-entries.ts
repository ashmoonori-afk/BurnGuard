/**
 * Per-format export entries. `export-options.ts` owns the types and the
 * dispatch; this module owns which entries each project shape offers and
 * which options each entry sends.
 */
import { t } from "@/i18n/t";
import type { GraphicCanvasV1, GraphicSetV1, ProjectType } from "@bg/shared";
import type {
  ExportMenuOption,
  ExportOptionField,
  ExportOptionValues,
} from "./export-options";

const CAFE24_ASSET_PREFIX = "/web/upload/burnguard/";

/** Cafe24 file-uploader path the package rewrites asset URLs to (doc/14 section 9.2). */
export function cafe24AssetBaseUrl(slug: string): string {
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return clean === "" ? CAFE24_ASSET_PREFIX : `${CAFE24_ASSET_PREFIX}${clean}/`;
}

const CAFE24_URL_FIELD: ExportOptionField = {
  kind: "asset_base_url",
  get label() { return t("export.field.assetUrl"); },
  get hint() { return t("export.field.cafe24Hint"); },
  get placeholder() { return `${CAFE24_ASSET_PREFIX}${t("export.field.slugPlaceholder")}`; },
};

const IMWEB_URL_FIELD: ExportOptionField = {
  kind: "asset_base_url",
  get label() { return t("export.field.assetUrlOptional"); },
  get hint() { return t("export.field.imwebHint"); },
  placeholder: "https://...",
};

const SLICE_FIELD: ExportOptionField = {
  kind: "slice",
  get label() { return t("export.field.slice"); },
  get hint() { return t("export.field.sliceHint"); },
};

function isWebProject(projectType: ProjectType): boolean {
  return projectType === "prototype" || projectType === "from_template" || projectType === "other";
}

function enteredAssetBaseUrl(values: ExportOptionValues): string {
  return values.assetBaseUrl.trim();
}

export function platformPackageOptions(
  projectType: ProjectType,
  values: ExportOptionValues,
): readonly ExportMenuOption[] {
  const entered = enteredAssetBaseUrl(values);
  const disabled = isWebProject(projectType) ? {} : { disabledReason: "web_only" as const };
  return [
    {
      key: "cafe24_package",
      format: "cafe24_package",
      label: t("export.option.cafe24"),
      options: { asset_base_url: entered === "" ? cafe24AssetBaseUrl("") : entered },
      fields: [CAFE24_URL_FIELD],
      ...disabled,
    },
    {
      key: "imweb_package",
      format: "imweb_package",
      label: t("export.option.imweb"),
      ...(entered === "" ? {} : { options: { asset_base_url: entered } }),
      fields: [IMWEB_URL_FIELD],
      ...disabled,
    },
  ];
}

/** Slide decks export one PNG per slide; nothing else in the web family has frames. */
export function deckFrameZipOption(projectType: ProjectType): ExportMenuOption {
  return {
    key: "png_zip",
    format: "png_zip",
    label: t("export.option.pngZip"),
    ...(projectType === "slide_deck" ? {} : { disabledReason: "frames_only" as const }),
  };
}

function slicedFrameZipOption(values: ExportOptionValues): ExportMenuOption {
  return {
    key: "png_zip",
    format: "png_zip",
    label: t("export.option.pngZip"),
    options: {
      slice_height: values.sliceHeight,
      slice_format: values.sliceFormat,
      ...(values.sliceFormat === "jpeg" ? { jpeg_quality: values.jpegQuality } : {}),
    },
    fields: [SLICE_FIELD],
  };
}

function framesAreUniform(set: GraphicSetV1): boolean {
  const frames = set.frames;
  if (frames === undefined || frames.length === 0) return true;
  const first = frames[0];
  if (first === undefined) return true;
  return frames.every((frame) => frame.width === first.width && frame.height === first.height);
}

export function graphicExportOptions(
  canvas: GraphicCanvasV1,
  set: GraphicSetV1,
  values: ExportOptionValues,
): readonly ExportMenuOption[] {
  const uniform = framesAreUniform(set);
  return [
    ...(set.kind === "single"
      ? [{
          key: "graphic-png",
          format: "png" as const,
          options: { png_width: canvas.width, png_height: canvas.height, png_dpr: 1 as const },
          label: `PNG · ${canvas.width}×${canvas.height}`,
        }]
      : []),
    ...(set.kind === "product_detail"
      ? [slicedFrameZipOption(values)]
      : set.frame_count > 1
        ? [{ key: "png_zip", format: "png_zip" as const, label: t("export.option.pngZip") }]
        : []),
    {
      key: "graphic-pdf-artboard",
      format: "pdf",
      options: { pdf_paper: "artboard" },
      label: t("export.option.pdfArtboard"),
      ...(uniform ? {} : { disabledReason: "mixed_frames" as const, note: t("export.option.mixedFrames") }),
    },
  ];
}
