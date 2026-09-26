import path from "node:path";
import { ulid } from "ulid";
import { DEFAULT_GENERATION_STYLE, DIRECTION_CANCELLATION_ERROR, DIRECTION_INTERRUPTION_ERROR, DIRECTION_RENDER_ERROR, parseGenerationStyle, type GenerationStyle, type DirectionDesignSystem, type DesignBriefV1, type DesignDirectionSlot, type DesignDirectionState, type ProjectType } from "@bg/shared";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import {
  activeDirectionGeneration,
  activeDirectionSignal,
  beginDirectionOperation,
  cancelDirectionOperation,
  finishDirectionOperation,
  isDirectionOperationActive,
} from "./direction-operation-registry";
import { SvgDesignDirectionRenderer, type DesignDirectionRenderer } from "./design-direction-renderer";
import { DirectionStateConflictError, getLatestDirectionState, publishDirectionState } from "./design-direction-state";

export { DIRECTION_CANCELLATION_ERROR, DIRECTION_INTERRUPTION_ERROR, DIRECTION_RENDER_ERROR } from "@bg/shared";

export class DesignDirectionWorkflowError extends Error {
  readonly name = "DesignDirectionWorkflowError";
  constructor(readonly code: "operation_active" | "operation_capacity" | "state_not_found" | "generation_conflict" | "revision_conflict" | "direction_not_ready" | "nothing_to_retry" | "nothing_to_undo" | "timestamp_overflow", message = code) { super(message); }
}

type ProjectSession = { readonly designSystem?: DirectionDesignSystem; readonly projectId: string; readonly sessionId: string; readonly projectDir: string; readonly projectName: string; readonly projectType: ProjectType; readonly designBrief: DesignBriefV1 | null };
type StartedGeneration = { readonly state: DesignDirectionState; readonly completion: Promise<DesignDirectionState> };
type ActiveCompletion = { readonly generationId: string; readonly promise: Promise<DesignDirectionState> };

export class DesignDirectionWorkflow {
  private readonly activeCompletions = new Map<string, ActiveCompletion>();

  constructor(private readonly renderer: DesignDirectionRenderer = new SvgDesignDirectionRenderer(), private readonly now: () => number = Date.now, private readonly id: () => string = ulid) {}

  async generate(input: ProjectSession, preferences?: GenerationStyle): Promise<StartedGeneration> {
    const generationId = assertSafeName(this.id());
    const prior = await getLatestDirectionState(input.sessionId);
    const state = { ...this.initialState(input, generationId), creative_preferences: parseGenerationStyle(preferences ?? prior?.creative_preferences ?? DEFAULT_GENERATION_STYLE) };
    return this.start(input, state, state.directions.map((slot) => slot.id));
  }

  async retry(input: ProjectSession): Promise<StartedGeneration> {
    const current = await this.requiredState(input.sessionId);
    const retryIds = current.directions.filter((slot) => slot.status === "failed" || slot.status === "cancelled").map((slot) => slot.id);
    if (retryIds.length === 0) throw new DesignDirectionWorkflowError("nothing_to_retry");
    const state = this.snapshot(current, {
      status: "loading",
      directions: current.directions.map((slot) => retryIds.includes(slot.id) ? { ...slot, status: "pending", preview_url: null, error: null } : slot),
      error: null,
    });
    return this.start(input, state, retryIds, current);
  }

  async cancel(sessionId: string): Promise<DesignDirectionState | null> {
    const generationId = activeDirectionGeneration(sessionId);
    const completion = this.activeCompletions.get(sessionId);
    if (generationId === null || completion?.generationId !== generationId || !cancelDirectionOperation(sessionId)) return null;
    return completion.promise;
  }

  async recover(sessionId: string): Promise<DesignDirectionState | null> {
    const current = await getLatestDirectionState(sessionId);
    if (current === null || current.status !== "loading" || activeDirectionGeneration(sessionId) === current.generation_id) return current;
    const directions = current.directions.map((slot) => slot.status === "pending" ? { ...slot, status: "failed" as const, preview_url: null, error: DIRECTION_INTERRUPTION_ERROR } : slot);
    const recovered = this.snapshot(current, { status: directions.some((slot) => slot.status === "ready") ? "partial" : "failed", directions, error: DIRECTION_INTERRUPTION_ERROR });
    await this.publishSnapshot(sessionId, recovered, current);
    return recovered;
  }

  async select(sessionId: string, generationId: string, revision: number, directionId: string): Promise<DesignDirectionState> {
    const current = await this.requiredState(sessionId);
    if (isDirectionOperationActive(sessionId)) throw new DesignDirectionWorkflowError("operation_active");
    this.checkIdentity(current, generationId, revision);
    if (!current.directions.some((slot) => slot.id === directionId && slot.status === "ready")) throw new DesignDirectionWorkflowError("direction_not_ready");
    const selected = this.snapshot(current, { selected_id: directionId, selection_revision: current.selection_revision + 1, selection_history: [...current.selection_history, current.selected_id] });
    await this.publishSnapshot(sessionId, selected, current);
    return selected;
  }

  async setPreferences(sessionId: string, generationId: string, revision: number, preferences: GenerationStyle): Promise<DesignDirectionState> {
    const current = await this.requiredState(sessionId);
    if (isDirectionOperationActive(sessionId)) throw new DesignDirectionWorkflowError("operation_active");
    this.checkIdentity(current, generationId, revision);
    const updated = this.snapshot(current, { creative_preferences: parseGenerationStyle(preferences), selection_revision: current.selection_revision + 1 });
    await this.publishSnapshot(sessionId, updated, current);
    return updated;
  }

  async undo(sessionId: string, generationId: string, revision: number): Promise<DesignDirectionState> {
    const current = await this.requiredState(sessionId);
    if (isDirectionOperationActive(sessionId)) throw new DesignDirectionWorkflowError("operation_active");
    this.checkIdentity(current, generationId, revision);
    const prior = current.selection_history.at(-1);
    if (prior === undefined) throw new DesignDirectionWorkflowError("nothing_to_undo");
    const undone = this.snapshot(current, { selected_id: prior, selection_revision: current.selection_revision + 1, selection_history: current.selection_history.slice(0, -1) });
    await this.publishSnapshot(sessionId, undone, current);
    return undone;
  }

  private async start(input: ProjectSession, state: DesignDirectionState, targetIds: readonly string[], expected?: DesignDirectionState): Promise<StartedGeneration> {
    if (isDirectionOperationActive(input.sessionId)) throw new DesignDirectionWorkflowError("operation_active");
    const controller = beginDirectionOperation(input.sessionId, state.generation_id);
    if (controller === null) throw new DesignDirectionWorkflowError("operation_capacity");
    try { await this.publishSnapshot(input.sessionId, state, expected); }
    catch (error) { finishDirectionOperation(input.sessionId, state.generation_id); throw error; }
    let resolveCompletion: (value: DesignDirectionState) => void = () => {};
    let rejectCompletion: (error: unknown) => void = () => {};
    const deferredCompletion = new Promise<DesignDirectionState>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    const completion = deferredCompletion.finally(() => this.finishCompletion(input.sessionId, state.generation_id));
    this.activeCompletions.set(input.sessionId, { generationId: state.generation_id, promise: completion });
    void this.run(input, state, targetIds).then(resolveCompletion, rejectCompletion);
    return { state, completion };
  }

  private async run(input: ProjectSession, started: DesignDirectionState, targetIds: readonly string[]): Promise<DesignDirectionState> {
    let state = started;
    for (const targetId of targetIds) {
      const slot = state.directions.find((candidate) => candidate.id === targetId);
      if (slot === undefined) continue;
      let replacement: DesignDirectionSlot;
      if (started.generation_id !== activeDirectionGeneration(input.sessionId)) break;
      const signal = this.operationSignal(input.sessionId, state.generation_id);
      try {
        const outputPath = directionPreviewPath(input.projectDir, state.generation_id, slot.id);
        await this.renderer.render({ layout: slot.layout_key, title: slot.title, summary: slot.summary, outline: state.content_outline, outputPath, signal, systemLayout: state.design_system?.layout });
        signal.throwIfAborted();
        replacement = { ...slot, status: "ready", preview_url: previewUrl(input.projectId, state.generation_id, slot.id), error: null };
      } catch (error) {
        if (signal.aborted) replacement = { ...slot, status: "cancelled", preview_url: null, error: DIRECTION_CANCELLATION_ERROR };
        else replacement = { ...slot, status: "failed", preview_url: null, error: DIRECTION_RENDER_ERROR };
      }
      let directions = state.directions.map((candidate) => candidate.id === slot.id ? replacement : candidate);
      if (replacement.status === "cancelled") directions = directions.map((candidate) => candidate.status === "pending" ? { ...candidate, status: "cancelled", preview_url: null, error: DIRECTION_CANCELLATION_ERROR } : candidate);
      state = this.snapshot(state, { directions, status: aggregateStatus(directions), error: aggregateError(directions) });
      await publishDirectionState(input.sessionId, state);
      if (replacement.status === "cancelled") break;
    }
    return state;
  }

  private finishCompletion(sessionId: string, generationId: string): void {
    if (this.activeCompletions.get(sessionId)?.generationId === generationId) this.activeCompletions.delete(sessionId);
    finishDirectionOperation(sessionId, generationId);
  }

  private async publishSnapshot(sessionId: string, state: DesignDirectionState, expected?: DesignDirectionState): Promise<void> {
    try { await publishDirectionState(sessionId, state, expected); }
    catch (error) { if (error instanceof DirectionStateConflictError) throw new DesignDirectionWorkflowError("revision_conflict"); throw error; }
  }

  private operationSignal(sessionId: string, generationId: string): AbortSignal {
    const signal = activeDirectionSignal(sessionId, generationId);
    if (signal === null) throw new DesignDirectionWorkflowError("generation_conflict");
    return signal;
  }

  private initialState(input: ProjectSession, generationId: string): DesignDirectionState {
    const locale = briefLocale(input.designBrief);
    return { schema_version: 1, project_id: input.projectId, session_id: input.sessionId, generation_id: generationId, status: "loading", content_outline: contentOutline(input, locale), directions: slotFixtures(locale, input.designSystem), ...(input.designSystem ? { design_system: input.designSystem } : {}), selected_id: null, selection_revision: 0, selection_history: [], error: null, updated_at: this.now() };
  }

  private snapshot(current: DesignDirectionState, changes: Partial<DesignDirectionState>): DesignDirectionState {
    const updatedAt = Math.max(this.now(), current.updated_at + 1);
    if (!Number.isSafeInteger(updatedAt)) throw new DesignDirectionWorkflowError("timestamp_overflow");
    return { ...current, ...changes, updated_at: updatedAt };
  }
  private async requiredState(sessionId: string): Promise<DesignDirectionState> { const state = await getLatestDirectionState(sessionId); if (state === null) throw new DesignDirectionWorkflowError("state_not_found"); return state; }
  private checkIdentity(state: DesignDirectionState, generationId: string, revision: number): void { if (state.generation_id !== generationId) throw new DesignDirectionWorkflowError("generation_conflict"); if (state.selection_revision !== revision) throw new DesignDirectionWorkflowError("revision_conflict"); }
}

type DirectionLocale = "ko" | "en" | "zh-CN";
type DirectionCopy = {
  readonly outline: (projectName: string) => readonly string[];
  readonly briefOutline: (brief: DesignBriefV1, projectType: ProjectType) => readonly string[];
  readonly systemTitles: readonly [string, string, string];
  readonly systemSummary: (systemName: string, order: number) => string;
  readonly systemFacts: (system: DirectionDesignSystem) => readonly string[];
  readonly slots: readonly { readonly title: string; readonly summary: string; readonly style_facts: readonly string[] }[];
};

/** Fixture copy per brief locale; the user reads these titles and outlines in the direction cards. */
const DIRECTION_COPY: Readonly<Record<DirectionLocale, DirectionCopy>> = {
  ko: {
    outline: (projectName) => [`${projectName}의 핵심 문제`, "근거와 해결 방향", "명확한 다음 행동"],
    briefOutline: (brief, projectType) => [`목표: ${brief.objective}`, `대상: ${brief.audience}`, `산출물: ${projectType} · ${brief.output_type} · ${brief.output_size}`],
    systemTitles: ["메시지 강조", "근거 강조", "행동 강조"],
    systemSummary: (systemName, order) => `${systemName}의 레이아웃을 유지하며 ${["핵심 메시지", "시각적 근거", "다음 행동"][order]}에 강조를 둡니다.`,
    systemFacts: (system) => [system.name, `${system.layout.tokens["--layout-columns"] ?? "미정"}열 · ${system.layout.tokens["--layout-max"] ?? "너비 미정"}`, "시스템 구성·폰트·색상 유지"],
    slots: [
      { title: "편집 서사", summary: "강한 제목과 여백으로 메시지를 압축합니다.", style_facts: ["비대칭 편집 그리드", "세리프 대형 제목", "크림과 적색 팔레트"] },
      { title: "모듈 시스템", summary: "정보를 비교 가능한 카드 체계로 정리합니다.", style_facts: ["12열 카드 그리드", "산세리프 정보 위계", "남색과 민트 팔레트"] },
      { title: "흐름 서사", summary: "시작부터 결론까지 시선의 경로를 만듭니다.", style_facts: ["곡선형 진행 구조", "단계별 강조 문구", "복숭아와 보라 팔레트"] },
    ],
  },
  en: {
    outline: (projectName) => [`Key problem of ${projectName}`, "Evidence and solution direction", "A clear next action"],
    briefOutline: (brief, projectType) => [`Goal: ${brief.objective}`, `Audience: ${brief.audience}`, `Output: ${projectType} · ${brief.output_type} · ${brief.output_size}`],
    systemTitles: ["Message emphasis", "Evidence emphasis", "Action emphasis"],
    systemSummary: (systemName, order) => `Keeps the ${systemName} layout and emphasizes ${["the key message", "the visual evidence", "the next action"][order]}.`,
    systemFacts: (system) => [system.name, `${system.layout.tokens["--layout-columns"] ?? "unset"} columns · ${system.layout.tokens["--layout-max"] ?? "width unset"}`, "System composition, fonts and colors kept"],
    slots: [
      { title: "Editorial narrative", summary: "Compresses the message with a strong headline and white space.", style_facts: ["Asymmetric editorial grid", "Large serif headline", "Cream and red palette"] },
      { title: "Modular system", summary: "Organizes information into comparable cards.", style_facts: ["12-column card grid", "Sans-serif information hierarchy", "Navy and mint palette"] },
      { title: "Flow narrative", summary: "Builds a path for the eye from opening to conclusion.", style_facts: ["Curved progression structure", "Step-by-step emphasis lines", "Peach and purple palette"] },
    ],
  },
  "zh-CN": {
    outline: (projectName) => [`${projectName}的核心问题`, "依据与解决方向", "明确的下一步行动"],
    briefOutline: (brief, projectType) => [`目标：${brief.objective}`, `对象：${brief.audience}`, `产出：${projectType} · ${brief.output_type} · ${brief.output_size}`],
    systemTitles: ["强调信息", "强调依据", "强调行动"],
    systemSummary: (systemName, order) => `保持 ${systemName} 的版式，突出${["核心信息", "视觉依据", "下一步行动"][order]}。`,
    systemFacts: (system) => [system.name, `${system.layout.tokens["--layout-columns"] ?? "未定"}栏 · ${system.layout.tokens["--layout-max"] ?? "宽度未定"}`, "保留系统构成、字体与颜色"],
    slots: [
      { title: "编辑叙事", summary: "以强有力的标题和留白压缩信息。", style_facts: ["非对称编辑网格", "大号衬线标题", "奶油色与红色配色"] },
      { title: "模块系统", summary: "将信息整理为可比较的卡片体系。", style_facts: ["12 栏卡片网格", "无衬线信息层级", "藏青与薄荷配色"] },
      { title: "流程叙事", summary: "从开头到结论构建视线路径。", style_facts: ["曲线推进结构", "分步强调语句", "桃色与紫色配色"] },
    ],
  },
};

function briefLocale(brief: DesignBriefV1 | null): DirectionLocale {
  const tag = brief?.locale.toLowerCase() ?? "";
  return tag.startsWith("en") ? "en" : tag.startsWith("zh") ? "zh-CN" : "ko";
}

function contentOutline(input: ProjectSession, locale: DirectionLocale): readonly string[] {
  const copy = DIRECTION_COPY[locale];
  return input.designBrief === null ? copy.outline(input.projectName) : copy.briefOutline(input.designBrief, input.projectType);
}

function slotFixtures(locale: DirectionLocale, system?: DirectionDesignSystem): readonly DesignDirectionSlot[] {
  const copy = DIRECTION_COPY[locale];
  return (["editorial", "modular", "narrative"] as const).map((key, order) => ({
    id: key, order, layout_key: key,
    ...(system
      ? { title: copy.systemTitles[order]!, summary: copy.systemSummary(system.name, order), style_facts: copy.systemFacts(system) }
      : copy.slots[order]!),
    status: "pending", preview_url: null, error: null,
  }));
}
function aggregateStatus(slots: readonly DesignDirectionSlot[]): DesignDirectionState["status"] { if (slots.some((slot) => slot.status === "pending")) return "loading"; if (slots.some((slot) => slot.status === "cancelled")) return "cancelled"; if (slots.every((slot) => slot.status === "ready")) return "ready"; if (slots.some((slot) => slot.status === "ready")) return "partial"; return "failed"; }
function aggregateError(slots: readonly DesignDirectionSlot[]): string | null { return slots.find((slot) => slot.error !== null)?.error ?? null; }
export function directionPreviewPath(projectDir: string, generationId: string, directionId: string): string { return resolveWithin(projectDir, ".meta", "directions", assertSafeName(generationId), `${assertSafeName(directionId)}.svg`); }
function previewUrl(projectId: string, generationId: string, directionId: string): string { return `/api/projects/${encodeURIComponent(projectId)}/design-directions/${encodeURIComponent(generationId)}/${encodeURIComponent(directionId)}/preview`; }
