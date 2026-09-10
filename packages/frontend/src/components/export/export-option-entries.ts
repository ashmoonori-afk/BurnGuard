/**
 * Per-format export entries. `export-options.ts` owns the types and the
 * dispatch; this module owns which entries each project shape offers and
 * which options each entry sends.
 */
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
  label: "에셋 주소",
  hint: "파일업로더나 FTP로 올릴 web/ 경로예요. 비워 두면 기본 경로를 씁니다.",
  placeholder: `${CAFE24_ASSET_PREFIX}<슬러그>/`,
};

const IMWEB_URL_FIELD: ExportOptionField = {
  kind: "asset_base_url",
  label: "에셋 주소 (선택)",
  hint: "큰 이미지는 게시판 글에 첨부해 얻은 URL을 넣어 주세요. 비워 두면 작은 이미지는 조각 안에 포함해요.",
  placeholder: "https://...",
};

const SLICE_FIELD: ExportOptionField = {
  kind: "slice",
  label: "이미지 조각",
  hint: "스마트스토어는 5000px, 쿠팡은 3000px 이하를 권장해요. 용량 제한이 있으면 JPEG로 바꾸세요.",
};

const MIXED_FRAMES_NOTE =
  "프레임 크기가 서로 달라 한 PDF로 묶을 수 없어요. 프레임마다 PNG는 만들 수 있으니 PNG 묶음 (ZIP)으로 내보내 주세요.";

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
      label: "카페24 스마트디자인 패키지",
      options: { asset_base_url: entered === "" ? cafe24AssetBaseUrl("") : entered },
      fields: [CAFE24_URL_FIELD],
      ...disabled,
    },
    {
      key: "imweb_package",
      format: "imweb_package",
      label: "아임웹 코드위젯 패키지",
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
    label: "PNG 묶음 (ZIP)",
    ...(projectType === "slide_deck" ? {} : { disabledReason: "frames_only" as const }),
  };
}

function slicedFrameZipOption(values: ExportOptionValues): ExportMenuOption {
  return {
    key: "png_zip",
    format: "png_zip",
    label: "PNG 묶음 (ZIP)",
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
        ? [{ key: "png_zip", format: "png_zip" as const, label: "PNG 묶음 (ZIP)" }]
        : []),
    {
      key: "graphic-pdf-artboard",
      format: "pdf",
      options: { pdf_paper: "artboard" },
      label: "PDF · 아트보드 크기",
      ...(uniform ? {} : { disabledReason: "mixed_frames" as const, note: MIXED_FRAMES_NOTE }),
    },
  ];
}
