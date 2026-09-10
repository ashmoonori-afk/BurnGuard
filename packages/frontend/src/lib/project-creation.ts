/**
 * Pure project-creation helpers. No React, no network, no data source.
 *
 * The panel collects a small Korean brief; this module is the single
 * place that decides which design systems may be chosen and how the
 * form maps onto the canonical `CreateProjectRequest`.
 */
import type {
  BackendId,
  CreateProjectRequest,
  DesignBriefContentSource,
  DesignBriefDensity,
  DesignBriefOutputSize,
  DesignBriefV1,
  DesignBriefVisualMood,
  DesignSystemSummary,
  GraphicDetailBriefV1,
  GraphicFrameV1,
  GraphicSetKind,
  GraphicSetV1,
  ProjectType,
} from "@bg/shared";
import {
  DESIGN_BRIEF_PAGE_LIMIT,
  GRAPHIC_CANVAS_LIMITS,
  UpgradeContractError,
  parseGraphicSetV1,
} from "@bg/shared";
import { DETAIL_BRIEF_FIELDS } from "@/lib/graphic-set-form";

export const BRIEF_LOCALE = "ko";
export const AUDIENCE_MAX_LENGTH = 200;
export const OBJECTIVE_MAX_LENGTH = 1000;
export const PROTOTYPE_PAGE_PRESETS = [
  { label: "회사소개", relPath: "about.html" },
  { label: "서비스", relPath: "services.html" },
  { label: "포트폴리오", relPath: "portfolio.html" },
  { label: "문의", relPath: "contact.html" },
  { label: "공지", relPath: "notice.html" },
] as const;
export const GRAPHIC_PRESETS = [
  { label: "정사각형", width: 1080, height: 1080 },
  { label: "SNS", width: 1200, height: 628 },
  { label: "세로형", width: 1080, height: 1920 },
] as const;

export type BriefChoice<T> = { readonly value: T; readonly label: string };

export const CONTENT_SOURCE_CHOICES: readonly BriefChoice<DesignBriefContentSource>[] =
  [
    { value: "none", label: "없음 · 새로 작성" },
    { value: "attached", label: "첨부한 자료" },
    { value: "template", label: "템플릿 내용" },
    { value: "existing_files", label: "프로젝트에 있는 파일" },
  ];

export const VISUAL_MOOD_CHOICES: readonly BriefChoice<DesignBriefVisualMood>[] =
  [
    { value: "formal", label: "격식 있게" },
    { value: "friendly", label: "친근하게" },
    { value: "premium", label: "고급스럽게" },
  ];

export const DENSITY_CHOICES: readonly BriefChoice<DesignBriefDensity>[] = [
  { value: "sparse", label: "여백 넉넉하게" },
  { value: "balanced", label: "보통" },
  { value: "dense", label: "정보 빽빽하게" },
];

export const OUTPUT_SIZE_CHOICES: readonly BriefChoice<DesignBriefOutputSize>[] =
  [
    { value: "responsive", label: "화면 크기에 맞춤" },
    { value: "widescreen-16x9", label: "와이드 16:9" },
    { value: "standard-4x3", label: "표준 4:3" },
    { value: "a4", label: "A4 문서" },
    { value: "letter", label: "레터 문서" },
  ];

export type ProjectDraft = {
  readonly name: string;
  readonly type: ProjectType;
  readonly backendId: BackendId;
  readonly designSystemId: string | null;
  readonly audience: string;
  readonly objective: string;
  readonly contentSource: DesignBriefContentSource;
  readonly visualMood: DesignBriefVisualMood;
  readonly density: DesignBriefDensity;
  readonly outputSize: DesignBriefOutputSize;
  readonly graphicWidth: number;
  readonly graphicHeight: number;
  readonly useSpeakerNotes: boolean;
  readonly copyAsIs: boolean;
  readonly sectionCount?: number;
  readonly pages: readonly string[];
  readonly graphicKind: GraphicSetKind;
  readonly frameCount: number;
  readonly frames: readonly GraphicFrameV1[];
  readonly presetId: string | null;
  readonly detailBrief: GraphicDetailBriefV1;
};

export type BriefForm = Omit<
  ProjectDraft,
  "type" | "backendId" | "designSystemId"
>;

export const INITIAL_BRIEF_FORM: BriefForm = {
  name: "",
  audience: "",
  objective: "",
  contentSource: "none",
  visualMood: "formal",
  density: "balanced",
  outputSize: "responsive",
  graphicWidth: 1080,
  graphicHeight: 1080,
  useSpeakerNotes: false,
  copyAsIs: false,
  sectionCount: 6,
  pages: [],
  graphicKind: "single",
  frameCount: 1,
  frames: [],
  presetId: null,
  detailBrief: {},
};

export const PROJECT_LABEL_CLASS = "text-xs font-medium text-foreground/80";
export const PROJECT_CONTROL_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground opacity-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50";

export type DraftProblem =
  | "section_count_invalid"
  | "pages_invalid"
  | "name_required"
  | "audience_invalid"
  | "objective_invalid"
  | "design_system_required"
  | "design_system_not_selectable"
  | "graphic_width_invalid"
  | "graphic_height_invalid"
  | "graphic_pixel_limit"
  | "graphic_set_invalid";

export type BuildResult =
  | { readonly ok: true; readonly request: CreateProjectRequest }
  | { readonly ok: false; readonly problem: DraftProblem };

export const PROBLEM_MESSAGE: Record<DraftProblem, string> = {
  pages_invalid: `페이지는 안전한 HTML 파일 이름으로 ${DESIGN_BRIEF_PAGE_LIMIT}개까지 선택해 주세요.`,
  section_count_invalid: "섹션 수는 1~30 사이의 정수로 입력해 주세요.",
  name_required: "프로젝트 이름을 입력해 주세요.",
  audience_invalid: `누가 보게 되는지 ${AUDIENCE_MAX_LENGTH}자 이내로 적어 주세요.`,
  objective_invalid: `무엇을 얻고 싶은지 ${OBJECTIVE_MAX_LENGTH}자 이내로 적어 주세요.`,
  design_system_required: "사용할 템플릿을 선택해 주세요.",
  design_system_not_selectable:
    "선택한 디자인 시스템은 지금 사용할 수 없어요. 목록에서 다시 골라 주세요.",
  graphic_width_invalid: "너비는 320~4096 사이의 정수로 입력해 주세요.",
  graphic_height_invalid: "높이는 240~16,384 사이의 정수로 입력해 주세요. 상세페이지처럼 긴 이미지도 이 범위 안에서 만들어요.",
  graphic_pixel_limit: "전체 픽셀은 1,600만 이하가 되도록 크기를 줄여 주세요.",
  graphic_set_invalid: "그래픽 종류와 장수, 입력한 내용을 다시 확인해 주세요. 배너 세트만 프레임별 크기를, 상세페이지만 상세 브리프를 사용할 수 있어요.",
};

/**
 * The panel builds exactly the payload the backend parses, then runs the shared
 * parser on it: an impossible combination is refused here instead of at create.
 */
function buildGraphicSet(draft: ProjectDraft): GraphicSetV1 | null {
  const detailBrief = Object.fromEntries(
    DETAIL_BRIEF_FIELDS.flatMap((field) => {
      const value = (draft.detailBrief[field.key] ?? "").trim();
      return value === "" ? [] : [[field.key, value]];
    }),
  ) as GraphicDetailBriefV1;
  const candidate = {
    schema_version: 1,
    kind: draft.graphicKind,
    frame_count: draft.frameCount,
    ...(draft.frames.length === 0 ? {} : { frames: draft.frames }),
    ...(draft.presetId === null ? {} : { preset_id: draft.presetId }),
    ...(Object.keys(detailBrief).length === 0 ? {} : { detail_brief: detailBrief }),
  };
  try {
    return parseGraphicSetV1(candidate);
  } catch (error) {
    if (error instanceof UpgradeContractError) return null;
    throw error;
  }
}

export function isOriginalSampleSystem(id: string | null): boolean {
  return /^sample-system-original-(sonnel|foliover|oddward|velune)$/.test(id ?? "");
}

/** Published original samples support each of their three actual formats. */
export function selectableDesignSystems(
  systems: readonly DesignSystemSummary[],
  type: ProjectType,
): DesignSystemSummary[] {
  const wantTemplate = type === "from_template";
  return systems.filter(
    (system) =>
      system.status === "published" && (wantTemplate || !system.is_template ||
        (isOriginalSampleSystem(system.id) && ["prototype", "slide_deck", "graphic"].includes(type))),
  );
}

/**
 * Keeps an explicit selection alive across list changes. Never picks a
 * system on the user's behalf: an unknown or no-longer-selectable id
 * collapses to "nothing selected".
 */
export function keepSelectedDesignSystemId(
  selectedId: string | null,
  selectable: readonly DesignSystemSummary[],
): string | null {
  if (selectedId === null) return null;
  return selectable.some((system) => system.id === selectedId)
    ? selectedId
    : null;
}

export function buildCreateProjectRequest(
  draft: ProjectDraft,
  systems: readonly DesignSystemSummary[],
): BuildResult {
  if (draft.type === "prototype" && (!Number.isSafeInteger(draft.sectionCount ?? 6) || (draft.sectionCount ?? 6) < 1 || (draft.sectionCount ?? 6) > 30)) return { ok: false, problem: "section_count_invalid" };
  const safePage = /^(?:[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\/)*[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\.html$/iu;
  const pagesValid = draft.pages.length <= DESIGN_BRIEF_PAGE_LIMIT
    && draft.pages.every((page) => safePage.test(page) && page.toLowerCase() !== "index.html")
    && new Set(draft.pages.map((page) => page.toLowerCase())).size === draft.pages.length;
  if ((draft.type !== "prototype" && draft.pages.length > 0) || !pagesValid) return { ok: false, problem: "pages_invalid" };
  const name = draft.name.trim();
  if (name.length === 0) return { ok: false, problem: "name_required" };

  const audience = draft.audience.trim();
  if (audience.length === 0 || audience.length > AUDIENCE_MAX_LENGTH) {
    return { ok: false, problem: "audience_invalid" };
  }

  const objective = draft.objective.trim();
  if (objective.length === 0 || objective.length > OBJECTIVE_MAX_LENGTH) {
    return { ok: false, problem: "objective_invalid" };
  }

  if (draft.type === "graphic") {
    if (
      !Number.isSafeInteger(draft.graphicWidth) ||
      draft.graphicWidth < GRAPHIC_CANVAS_LIMITS.minWidth ||
      draft.graphicWidth > GRAPHIC_CANVAS_LIMITS.maxWidth
    ) {
      return { ok: false, problem: "graphic_width_invalid" };
    }
    if (
      !Number.isSafeInteger(draft.graphicHeight) ||
      draft.graphicHeight < GRAPHIC_CANVAS_LIMITS.minHeight ||
      draft.graphicHeight > GRAPHIC_CANVAS_LIMITS.maxHeight
    ) {
      return { ok: false, problem: "graphic_height_invalid" };
    }
    if (draft.graphicWidth * draft.graphicHeight > GRAPHIC_CANVAS_LIMITS.maxPixels) {
      return { ok: false, problem: "graphic_pixel_limit" };
    }
  }

  const graphicSet = draft.type === "graphic" ? buildGraphicSet(draft) : null;
  if (draft.type === "graphic" && graphicSet === null) {
    return { ok: false, problem: "graphic_set_invalid" };
  }

  const selectable = selectableDesignSystems(systems, draft.type);
  const designSystemId = keepSelectedDesignSystemId(
    draft.designSystemId,
    selectable,
  );
  if (designSystemId === null && draft.designSystemId !== null) {
    return { ok: false, problem: "design_system_not_selectable" };
  }
  if (designSystemId === null && draft.type === "from_template") {
    return { ok: false, problem: "design_system_required" };
  }

  const brief: DesignBriefV1 = {
    ...(draft.type === "prototype" ? {
      section_count: draft.sectionCount ?? 6,
      ...(draft.pages.length === 0 ? {} : { pages: draft.pages }),
    } : {}),
    schema_version: 1,
    output_type: draft.type,
    audience,
    objective,
    content_source: draft.contentSource,
    locale: BRIEF_LOCALE,
    brand_mode:
      draft.type === "from_template"
        ? "template"
        : designSystemId === null
          ? "none"
          : "selected_design_system",
    visual_mood: draft.visualMood,
    density: draft.density,
    output_size: draft.type === "graphic" ? "custom" : draft.outputSize,
  };

  return {
    ok: true,
    request: {
      name,
      type: draft.type,
      design_system_id: designSystemId,
      backend_id: draft.backendId,
      options: {
        ...(draft.type === "slide_deck"
          ? { use_speaker_notes: draft.useSpeakerNotes }
          : {}),
        ...(draft.type === "from_template"
          ? { copy_as_is: draft.copyAsIs }
          : {}),
        ...(draft.type === "graphic" && graphicSet !== null
          ? {
              graphic_canvas: {
                schema_version: 1 as const,
                width: draft.graphicWidth,
                height: draft.graphicHeight,
              },
              graphic_set: graphicSet,
            }
          : {}),
        design_brief: brief,
      },
    },
  };
}
