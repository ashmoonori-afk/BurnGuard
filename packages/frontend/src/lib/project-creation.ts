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
import { t, type MessageKey } from "@/i18n/t";

export const BRIEF_LOCALE = "ko";
export const AUDIENCE_MAX_LENGTH = 200;
export const OBJECTIVE_MAX_LENGTH = 1000;
export const PROTOTYPE_PAGE_PRESETS = [
  { label: "home.page.about", relPath: "about.html" },
  { label: "home.page.services", relPath: "services.html" },
  { label: "home.page.portfolio", relPath: "portfolio.html" },
  { label: "home.page.contact", relPath: "contact.html" },
  { label: "home.page.notice", relPath: "notice.html" },
] as const;
export const GRAPHIC_PRESETS = [
  { label: "home.graphic.square", width: 1080, height: 1080 },
  { label: "home.graphic.social", width: 1200, height: 628 },
  { label: "home.graphic.portrait", width: 1080, height: 1920 },
] as const;

export type BriefChoice<T> = { readonly value: T; readonly label: MessageKey };

export const CONTENT_SOURCE_CHOICES: readonly BriefChoice<DesignBriefContentSource>[] =
  [
    { value: "none", label: "home.brief.source.none" },
    { value: "attached", label: "home.brief.source.attached" },
    { value: "template", label: "home.brief.source.template" },
    { value: "existing_files", label: "home.brief.source.existing" },
  ];

export const VISUAL_MOOD_CHOICES: readonly BriefChoice<DesignBriefVisualMood>[] =
  [
    { value: "formal", label: "home.brief.mood.formal" },
    { value: "friendly", label: "home.brief.mood.friendly" },
    { value: "premium", label: "home.brief.mood.premium" },
  ];

export const DENSITY_CHOICES: readonly BriefChoice<DesignBriefDensity>[] = [
  { value: "sparse", label: "home.brief.density.sparse" },
  { value: "balanced", label: "home.brief.density.balanced" },
  { value: "dense", label: "home.brief.density.dense" },
];

export const OUTPUT_SIZE_CHOICES: readonly BriefChoice<DesignBriefOutputSize>[] =
  [
    { value: "responsive", label: "home.brief.size.responsive" },
    { value: "widescreen-16x9", label: "home.brief.size.widescreen" },
    { value: "standard-4x3", label: "home.brief.size.standard" },
    { value: "a4", label: "home.brief.size.a4" },
    { value: "letter", label: "home.brief.size.letter" },
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

export const PROBLEM_MESSAGE: Record<DraftProblem, MessageKey> = {
  pages_invalid: "home.problem.pages",
  section_count_invalid: "home.problem.sections",
  name_required: "home.problem.name",
  audience_invalid: "home.problem.audience",
  objective_invalid: "home.problem.objective",
  design_system_required: "home.problem.template",
  design_system_not_selectable: "home.problem.system",
  graphic_width_invalid: "home.problem.width",
  graphic_height_invalid: "home.problem.height",
  graphic_pixel_limit: "home.problem.pixels",
  graphic_set_invalid: "home.problem.graphicSet",
};

export function draftProblemMessage(problem: DraftProblem): string {
  const count = problem === "pages_invalid" ? DESIGN_BRIEF_PAGE_LIMIT
    : problem === "audience_invalid" ? AUDIENCE_MAX_LENGTH
    : problem === "objective_invalid" ? OBJECTIVE_MAX_LENGTH : undefined;
  return t(PROBLEM_MESSAGE[problem], count === undefined ? undefined : { count: String(count) });
}

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
