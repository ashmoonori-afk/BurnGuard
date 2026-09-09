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
  ProjectType,
} from "@bg/shared";
import { GRAPHIC_CANVAS_LIMITS } from "@bg/shared";

export const BRIEF_LOCALE = "ko";
export const AUDIENCE_MAX_LENGTH = 200;
export const OBJECTIVE_MAX_LENGTH = 1000;
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
};

export const PROJECT_LABEL_CLASS = "text-xs font-medium text-foreground/80";
export const PROJECT_CONTROL_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground opacity-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50";

export type DraftProblem =
  | "section_count_invalid"
  | "name_required"
  | "audience_invalid"
  | "objective_invalid"
  | "design_system_required"
  | "design_system_not_selectable"
  | "graphic_width_invalid"
  | "graphic_height_invalid"
  | "graphic_pixel_limit";

export type BuildResult =
  | { readonly ok: true; readonly request: CreateProjectRequest }
  | { readonly ok: false; readonly problem: DraftProblem };

export const PROBLEM_MESSAGE: Record<DraftProblem, string> = {
  section_count_invalid: "섹션 수는 1~30 사이의 정수로 입력해 주세요.",
  name_required: "프로젝트 이름을 입력해 주세요.",
  audience_invalid: `누가 보게 되는지 ${AUDIENCE_MAX_LENGTH}자 이내로 적어 주세요.`,
  objective_invalid: `무엇을 얻고 싶은지 ${OBJECTIVE_MAX_LENGTH}자 이내로 적어 주세요.`,
  design_system_required: "사용할 템플릿을 선택해 주세요.",
  design_system_not_selectable:
    "선택한 디자인 시스템은 지금 사용할 수 없어요. 목록에서 다시 골라 주세요.",
  graphic_width_invalid: "너비는 320~4096 사이의 정수로 입력해 주세요.",
  graphic_height_invalid: "높이는 240~4096 사이의 정수로 입력해 주세요.",
  graphic_pixel_limit: "전체 픽셀은 1,600만 이하가 되도록 크기를 줄여 주세요.",
};

/**
 * Design systems the user may pick for `type`. Template projects can
 * start from any published system because real installs do not seed
 * template-marked rows. Every other project type excludes templates,
 * and no project can select a half-finished draft.
 */
export function selectableDesignSystems(
  systems: readonly DesignSystemSummary[],
  type: ProjectType,
): DesignSystemSummary[] {
  const wantTemplate = type === "from_template";
  return systems.filter(
    (system) =>
      system.status === "published" && (wantTemplate || !system.is_template),
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
    ...(draft.type === "prototype" ? { section_count: draft.sectionCount ?? 6 } : {}),
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
        ...(draft.type === "graphic"
          ? {
              graphic_canvas: {
                schema_version: 1 as const,
                width: draft.graphicWidth,
                height: draft.graphicHeight,
              },
            }
          : {}),
        design_brief: brief,
      },
    },
  };
}
