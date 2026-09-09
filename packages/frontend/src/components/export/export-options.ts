import {
  type ExportFormat,
  type ExportOptions,
  type ProjectType,
} from "@bg/shared";
import { parseProjectGraphicCanvas } from "@/lib/graphic-project";

export type ExportMenuOption = {
  readonly key: string;
  readonly format: ExportFormat;
  readonly options?: ExportOptions;
  readonly label: string;
  readonly disabledReason?: "deck_only";
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
  launch_timeout: "Chromium 렌더링을 완료하지 못했어요. 설정에서 Chromium 상태를 확인한 뒤 다시 시도해 주세요.",
  not_installed: 'Chromium이 설치되어 있지 않아요. 설정 → "내보내기용 Chromium" → 설치를 실행한 뒤 다시 내보내 주세요.',
};

export type ExportRetryRequest = {
  readonly format: ExportFormat;
  readonly options?: ExportOptions;
};

export function buildExportRetryRequest(
  projectType: ProjectType,
  format: ExportFormat,
  model: ExportMenuModel,
): ExportRetryRequest | null {
  if (projectType !== "graphic") return { format };
  if (!model.ok) return null;
  const matches = model.options.filter((option) => option.format === format);
  const option = matches.length === 1 ? matches[0] : undefined;
  if (option === undefined || option.options === undefined) return null;
  return { format, options: option.options };
}

const STANDARD_OPTIONS = [
  { key: "html_zip", format: "html_zip", label: "HTML ZIP 파일" },
  { key: "pdf-a4", format: "pdf", options: { pdf_paper: "a4" }, label: "PDF · A4 가로" },
  { key: "pdf-letter", format: "pdf", options: { pdf_paper: "letter" }, label: "PDF · 레터 가로" },
  { key: "pdf-widescreen", format: "pdf", options: { pdf_paper: "widescreen-16x9" }, label: "PDF · 16:9 와이드스크린" },
  { key: "pptx-16x9", format: "pptx", options: { pptx_size: "16x9" }, label: "파워포인트 · 16:9" },
  { key: "pptx-4x3", format: "pptx", options: { pptx_size: "4x3" }, label: "파워포인트 · 4:3" },
  { key: "handoff", format: "handoff", label: "개발자 전달용 (.zip)" },
] as const satisfies readonly ExportMenuOption[];

export function buildExportMenuModel(
  projectType: ProjectType,
  optionsJson: string | null,
): ExportMenuModel {
  if (projectType !== "graphic") {
    return {
      ok: true,
      options: projectType === "slide_deck"
        ? STANDARD_OPTIONS
        : STANDARD_OPTIONS.map((option) =>
            option.format === "pdf" || option.format === "pptx"
              ? { ...option, disabledReason: "deck_only" as const }
              : option,
          ),
    };
  }
  const canvas = parseProjectGraphicCanvas(projectType, optionsJson);
  if (canvas === null) {
    return {
      ok: false,
      options: [],
      message: "저장된 그래픽 크기를 확인할 수 없어 PNG 내보내기를 시작할 수 없어요.",
    };
  }
  return {
    ok: true,
    options: [{
      key: "graphic-png",
      format: "png",
      options: {
        png_width: canvas.width,
        png_height: canvas.height,
        png_dpr: 1,
      },
      label: `PNG · ${canvas.width}×${canvas.height}`,
    }],
  };
}
