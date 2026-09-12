import { t } from "@/i18n/t";
import {
  DEFAULT_GRAPHIC_SET,
  type ExportFormat,
  type ExportOptions,
  type ProjectType,
} from "@bg/shared";
import {
  parseProjectGraphicCanvas,
  parseProjectGraphicSet,
} from "@/lib/graphic-project";
import {
  cafe24AssetBaseUrl,
  deckFrameZipOption,
  graphicExportOptions,
  platformPackageOptions,
} from "./export-option-entries";

export { cafe24AssetBaseUrl };

export type ExportOptionDisabledReason =
  | "deck_only"
  | "web_only"
  | "frames_only"
  | "mixed_frames";

export const EXPORT_DISABLED_LABEL: Record<ExportOptionDisabledReason, string> = {
  get deck_only() { return t("export.disabled.deck_only"); },
  get web_only() { return t("export.disabled.web_only"); },
  get frames_only() { return t("export.disabled.frames_only"); },
  get mixed_frames() { return t("export.disabled.mixed_frames"); },
};

export type ExportOptionField = {
  readonly kind: "asset_base_url" | "slice";
  readonly label: string;
  readonly hint: string;
  readonly placeholder?: string;
};

/** Values the user edits in the menu before starting an export. */
export type ExportOptionValues = {
  readonly assetBaseUrl: string;
  readonly sliceHeight: 3000 | 5000;
  readonly sliceFormat: "png" | "jpeg";
  readonly jpegQuality: number;
};

export const DEFAULT_EXPORT_OPTION_VALUES: ExportOptionValues = {
  assetBaseUrl: "",
  sliceHeight: 5000,
  sliceFormat: "png",
  jpegQuality: 85,
};

export type ExportMenuOption = {
  readonly key: string;
  readonly format: ExportFormat;
  readonly options?: ExportOptions;
  readonly label: string;
  readonly fields?: readonly ExportOptionField[];
  readonly note?: string;
  readonly disabledReason?: ExportOptionDisabledReason;
};

export type ExportMenuModel =
  | { readonly ok: true; readonly options: readonly ExportMenuOption[] }
  | {
      readonly ok: false;
      readonly options: readonly [];
      readonly message: string;
    };

export type ChromiumFailure = "launch_timeout" | "not_installed";

/**
 * Export attempts report Chromium trouble as the render error message, which
 * carries the backend error code. The bare "chromium" substring stays as the
 * fallback for older messages that predate the codes.
 */
export function classifyChromiumFailure(errorMessage: string | null): ChromiumFailure | null {
  if (errorMessage === null) return null;
  if (errorMessage.includes("chromium_launch_timeout")) return "launch_timeout";
  if (errorMessage.includes("chromium_not_installed")) return "not_installed";
  return errorMessage.toLowerCase().includes("chromium") ? "not_installed" : null;
}

export const CHROMIUM_FAILURE_MESSAGE: Record<ChromiumFailure, string> = {
  get launch_timeout() { return t("export.chromium.launch_timeout"); },
  get not_installed() { return t("export.chromium.not_installed"); },
};

export type ExportRetryRequest = {
  readonly format: ExportFormat;
  readonly options?: ExportOptions;
};

/**
 * A retry re-sends the same choice, so whatever options the entry carries
 * (asset base URL, slice format, artboard paper) ride along unchanged. Only a
 * graphic project without a resolvable entry has no safe fallback.
 */
export function buildExportRetryRequest(
  projectType: ProjectType,
  format: ExportFormat,
  model: ExportMenuModel,
): ExportRetryRequest | null {
  const matches = model.ok ? model.options.filter((option) => option.format === format) : [];
  const option = matches.length === 1 ? matches[0] : undefined;
  if (option?.options !== undefined) return { format, options: option.options };
  return projectType === "graphic" ? null : { format };
}

function standardOptions(): readonly ExportMenuOption[] {
  return [
    { key: "html_zip", format: "html_zip", label: t("export.format.html_zip") },
    { key: "pdf-a4", format: "pdf", options: { pdf_paper: "a4" }, label: t("export.option.pdfA4") },
    { key: "pdf-letter", format: "pdf", options: { pdf_paper: "letter" }, label: t("export.option.pdfLetter") },
    { key: "pdf-widescreen", format: "pdf", options: { pdf_paper: "widescreen-16x9" }, label: t("export.option.pdfWide") },
    { key: "pptx-16x9", format: "pptx", options: { pptx_size: "16x9" }, label: t("export.option.pptxWide"), note: t("export.option.pptxWideNote") },
    { key: "pptx-4x3", format: "pptx", options: { pptx_size: "4x3" }, label: t("export.option.pptxStandard"), note: t("export.option.pptxStandardNote") },
    { key: "handoff", format: "handoff", label: t("export.option.handoff") },
  ];
}

export function buildExportMenuModel(
  projectType: ProjectType,
  optionsJson: string | null,
  values: ExportOptionValues = DEFAULT_EXPORT_OPTION_VALUES,
): ExportMenuModel {
  if (projectType !== "graphic") {
    return {
      ok: true,
      options: [
        ...(projectType === "slide_deck"
          ? standardOptions()
          : standardOptions().map((option) =>
              option.format === "pdf" || option.format === "pptx"
                ? { ...option, disabledReason: "deck_only" as const }
                : option,
            )),
        deckFrameZipOption(projectType),
        ...platformPackageOptions(projectType, values),
      ],
    };
  }
  const canvas = parseProjectGraphicCanvas(projectType, optionsJson);
  if (canvas === null) {
    return {
      ok: false,
      options: [],
      message: t("export.option.invalidCanvas"),
    };
  }
  const set = parseProjectGraphicSet(projectType, optionsJson) ?? DEFAULT_GRAPHIC_SET;
  return {
    ok: true,
    options: [
      ...graphicExportOptions(canvas, set, values),
      ...platformPackageOptions(projectType, values),
    ],
  };
}
