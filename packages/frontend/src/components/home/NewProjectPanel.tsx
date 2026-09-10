import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type {
  BackendId,
  CreateProjectRequest,
  CreateProjectResponse,
  DesignSystemSummary,
  ProjectType,
  GenerationOptions,
} from "@bg/shared";
import { defaultGenerationOptions } from "@bg/shared";
import GenerationControls from "@/components/settings/GenerationControls";
import { createProject } from "@/api/home";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProjectBriefFields, {
  ToggleRow,
} from "@/components/home/ProjectBriefFields";
import { GraphicCanvasFields } from "@/components/home/GraphicCanvasFields";
import { GraphicSetFields } from "@/components/home/GraphicSetFields";
import { apiErrorCopy } from "@/lib/error-copy";
import { readCreationDraft, writeCreationDraft } from "@/lib/creation-draft";
import {
  INITIAL_BRIEF_FORM,
  PROBLEM_MESSAGE,
  PROJECT_CONTROL_CLASS,
  PROJECT_LABEL_CLASS,
  PROTOTYPE_PAGE_PRESETS,
  buildCreateProjectRequest,
  keepSelectedDesignSystemId,
  isOriginalSampleSystem,
  selectableDesignSystems,
  type BriefForm,
} from "@/lib/project-creation";
import ComposerAttachments from "@/components/chat/ComposerAttachments";
import { planAttachmentIntake, setAttachmentRole, COMPOSER_SUPPORTED_EXTENSIONS, type IntakeItem } from "@/components/chat/attachment-intake";
import { saveComposerDraft } from "@/components/chat/useComposerDraft";
import { useUIStore } from "@/state/uiStore";

export type { ProjectType };

export default function NewProjectPanel({
  type,
  designSystems,
  defaultBackend,
  graphicReady = false,
  generationDefaults,
  systemsLoading,
  systemsError,
  onRetrySystems,
  onPendingChange,
  onCreated,
}: {
  type: ProjectType;
  designSystems: DesignSystemSummary[];
  defaultBackend: BackendId;
  graphicReady?: boolean;
  generationDefaults?: Partial<Record<BackendId, GenerationOptions>>;
  systemsLoading: boolean;
  systemsError: Error | null;
  onRetrySystems: () => void;
  onPendingChange?: (pending: boolean) => void;
  onCreated: (project: CreateProjectResponse) => void;
}) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [backendId, setBackendId] = useState<BackendId>(defaultBackend);
  const [templateFormat, setTemplateFormat] = useState<"prototype" | "slide_deck" | "graphic">("prototype");
  const [generationByBackend, setGenerationByBackend] = useState(generationDefaults ?? {});
  const [form, setForm] = useState<BriefForm>(() => readCreationDraft(type));
  const draftTypeRef = useRef(type);
  const [pickedSystemId, setPickedSystemId] = useState<string | null>(null);
  const [items, setItems] = useState<readonly IntakeItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Derived on every render instead of synced by an effect: a late
  // design-system fetch or a project-type switch can never silently
  // promote a draft system into the user's explicit choice.
  const selectable = selectableDesignSystems(designSystems, type);
  const designSystemId = keepSelectedDesignSystemId(
    pickedSystemId,
    selectable,
  );
  const isTemplate = type === "from_template";
  const isOriginal = isOriginalSampleSystem(designSystemId);
  const effectiveType = isTemplate && isOriginal ? templateFormat : type;
  const isGraphic = effectiveType === "graphic";
  const effectiveBackend = isGraphic ? "codex" : backendId;
  const generation = generationByBackend[effectiveBackend] ?? defaultGenerationOptions(effectiveBackend);

  const createMutation = useMutation({
    mutationFn: (request: CreateProjectRequest) => createProject(request),
    onSuccess: async (created) => {
      try { await saveComposerDraft(created.session_id, { text: form.objective, items: items.filter((item) => item.status === "ready"), generation }); }
      catch { pushToast({ title: "초안을 메시지 작성창으로 옮겼어요", body: "브라우저 저장이 제한돼 있어요. 새로고침하기 전에 전송해 주세요.", tone: "error" }); }
      setItems([]);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onCreated(created);
      setForm(INITIAL_BRIEF_FORM);
      setPickedSystemId(null);
      setError(null);
    },
    onError: (err) => {
      const message = apiErrorCopy(err);
      setError(message);
      pushToast({
        title: "프로젝트를 만들지 못했어요",
        body: message,
        tone: "error",
      });
    },
  });

  const built = buildCreateProjectRequest(
    { ...form, contentSource: items.some((item) => item.status === "ready") ? "attached" : form.contentSource, type: effectiveType, backendId: effectiveBackend, designSystemId, ...(isOriginal && isGraphic ? { graphicWidth: 1080, graphicHeight: 1350 } : {}) },
    designSystems,
  );
  const disabled = createMutation.isPending;

  useEffect(() => {
    onPendingChange?.(disabled);
    return () => onPendingChange?.(false);
  }, [disabled, onPendingChange]);

  // What the user typed is a draft: it survives navigation, reload, and a
  // failed create, and each project type keeps its own.
  useEffect(() => {
    if (draftTypeRef.current === type) {
      writeCreationDraft(type, form);
      return;
    }
    draftTypeRef.current = type;
    setForm(readCreationDraft(type));
  }, [form, type]);

  function update<K extends keyof BriefForm>(key: K, value: BriefForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form className="p-6" onSubmit={(event) => {
      event.preventDefault();
      if (!built.ok || disabled || (isGraphic && !graphicReady)) return;
      setError(null);
      createMutation.mutate(built.request);
    }}>
      <h2 className="mb-3 text-xs font-semibold text-muted-foreground">02 · 프로젝트 기본 정보</h2>

      <div className="space-y-4">
        <div className="space-y-2"><label htmlFor="creation-backend" className={PROJECT_LABEL_CLASS}>AI 도구</label><select id="creation-backend" className={PROJECT_CONTROL_CLASS} value={effectiveBackend} disabled={disabled || isGraphic} onChange={(event) => setBackendId(event.target.value === "codex" ? "codex" : "claude-code")}><option value="claude-code">Claude Code</option><option value="codex">Codex</option></select><GenerationControls backendId={effectiveBackend} value={generation} disabled={disabled} onChange={(value) => setGenerationByBackend((current) => ({ ...current, [effectiveBackend]: value }))} /></div>
        <div className="space-y-1.5">
          <label htmlFor="project-name" className={PROJECT_LABEL_CLASS}>
            프로젝트 이름
          </label>
          <Input
            id="project-name"
            placeholder="예: 다음 분기 브랜드 제안서"
            value={form.name}
            autoFocus
            required
            disabled={disabled}
            onChange={(e) => update("name", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="design-system" className={PROJECT_LABEL_CLASS}>
            {isTemplate ? "사용할 템플릿" : "디자인 시스템"}
          </label>
          <select
            id="design-system"
            value={designSystemId ?? ""}
            disabled={
              disabled ||
              systemsLoading ||
              systemsError !== null ||
              selectable.length === 0
            }
            onChange={(e) => setPickedSystemId(e.target.value || null)}
            className={PROJECT_CONTROL_CLASS}
          >
            <option value="">
              {systemsLoading
                ? "불러오는 중..."
                : systemsError
                  ? "불러오지 못했어요"
                  : selectable.length === 0
                    ? isTemplate
                      ? "사용할 수 있는 템플릿이 없어요"
                      : "사용할 수 있는 디자인 시스템이 없어요"
                    : isTemplate
                      ? "템플릿을 선택하세요"
                      : "디자인 시스템 없이 시작"}
            </option>
            {systemsLoading || systemsError
              ? null
              : selectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
          </select>
          {systemsError ? (
            <button
              type="button"
              onClick={onRetrySystems}
              className="text-xs font-medium text-accent underline underline-offset-2 hover:no-underline"
            >
              다시 시도
            </button>
          ) : null}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {systemsLoading
            ? "디자인 시스템을 불러오는 중이에요."
            : systemsError
              ? "디자인 시스템을 불러오지 못했어요. 로컬 서버가 켜져 있는지 확인해 주세요."
              : selectable.length === 0
                ? isTemplate ? "게시된 템플릿이 아직 없어요. 디자인 시스템에서 초안을 만들고 게시하면 사용할 수 있어요." : "디자인 시스템 없이 시작할 수 있어요. 나만의 색상과 글꼴은 디자인 시스템에서 관리해요."
                : isOriginal
                  ? "선택한 브랜드의 완성된 웹·슬라이드·그래픽 샘플로 시작해요. 만든 뒤 내용과 디자인을 수정할 수 있어요."
                : isTemplate
                  ? "게시된 디자인 시스템을 템플릿으로 사용할 수 있어요."
                  : "게시된 디자인 시스템만 목록에 나와요. 없이도 시작할 수 있어요."}
        </p>

        {isTemplate && isOriginal && (
          <div className="space-y-1.5">
            <label htmlFor="template-format" className={PROJECT_LABEL_CLASS}>만들 형식</label>
            <select id="template-format" className={PROJECT_CONTROL_CLASS} value={templateFormat} disabled={disabled} onChange={(event) => {
              const value = event.target.value;
              if (value === "prototype" || value === "slide_deck" || value === "graphic") setTemplateFormat(value);
            }}>
              <option value="prototype">웹 페이지</option>
              <option value="slide_deck">슬라이드</option>
              <option value="graphic">그래픽 · 1080 × 1350</option>
            </select>
          </div>
        )}

        {isGraphic && (
          <GraphicCanvasFields
            width={isOriginal ? 1080 : form.graphicWidth}
            height={isOriginal ? 1350 : form.graphicHeight}
            disabled={disabled || isOriginal}
            onChange={(size) => setForm((current) => ({
              ...current,
              graphicWidth: size.width,
              graphicHeight: size.height,
            }))}
          />
        )}

        {isGraphic && !isOriginal && (
          <GraphicSetFields
            form={form}
            disabled={disabled}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          />
        )}

        {effectiveType === "prototype" && <>
          <div className="space-y-1.5"><label htmlFor="section-count" className={PROJECT_LABEL_CLASS}>세로 섹션 수</label><Input id="section-count" type="number" min={1} max={30} step={1} value={form.sectionCount ?? 6} disabled={disabled} onChange={(event) => update("sectionCount", event.target.valueAsNumber)} /><p className="text-xs text-muted-foreground">탐색 메뉴와 푸터를 제외한 본문 섹션 수예요.</p></div>
          <fieldset className="space-y-2" disabled={disabled}>
            <legend className={PROJECT_LABEL_CLASS}>페이지 구성</legend>
            <div className="flex flex-wrap gap-2">
              {PROTOTYPE_PAGE_PRESETS.map((preset) => {
                const selected = form.pages.includes(preset.relPath);
                return <button key={preset.relPath} type="button" aria-pressed={selected} aria-label={`${preset.label} 페이지 ${selected ? "제외" : "추가"}`} onClick={() => update("pages", selected ? form.pages.filter((page) => page !== preset.relPath) : [...form.pages, preset.relPath])} className={selected ? "min-h-9 rounded-full border border-accent bg-accent-soft px-3 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "min-h-9 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}>{preset.label}</button>;
              })}
            </div>
            <p className="text-xs text-muted-foreground">홈(index.html)은 자동으로 포함돼요.</p>
          </fieldset>
        </>}
        <div className="space-y-2"><label htmlFor="project-materials" className={PROJECT_LABEL_CLASS}>참고 자료 첨부</label><input id="project-materials" type="file" multiple accept={COMPOSER_SUPPORTED_EXTENSIONS.join(",")} disabled={disabled} onChange={(event) => { const picked = Array.from(event.target.files ?? []); setItems((current) => planAttachmentIntake(current, picked)); event.target.value = ""; }} className="block w-full text-sm" /><p className="text-xs text-muted-foreground">PDF·PPTX, 최대 8개 · 파일당 10 MB · 합계 25 MB. 프로젝트 생성 시 docs/attachments에 원본을 저장해요. 직접 전송할 때 AI에 전달하며, 첨부를 빼도 저장된 원본은 남아요.</p><ComposerAttachments items={items} sending={disabled} onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))} onRoleChange={(id, role) => setItems((current) => setAttachmentRole(current, id, role))} /></div>
        <ProjectBriefFields
          form={form}
          disabled={disabled}
          onChange={update}
          showOutputSize={!isGraphic}
        />

        {effectiveType === "slide_deck" && (
          <ToggleRow
            title="발표자 노트 사용"
            hint="슬라이드 위 글자를 줄여요"
            checked={form.useSpeakerNotes}
            disabled={disabled}
            onChange={(v) => update("useSpeakerNotes", v)}
          />
        )}

        {isTemplate && !isOriginal && (
          <ToggleRow
            title="템플릿을 그대로 복사"
            hint="구조는 유지하고 내용만 바꿔요"
            checked={form.copyAsIs}
            disabled={disabled}
            onChange={(v) => update("copyAsIs", v)}
          />
        )}
      </div>

      {isGraphic && !graphicReady && <p role="status" className="mt-4 text-sm text-muted-foreground">그래픽을 만들려면 설정에서 Codex를 연결하고 로그인해 주세요.</p>}
      <Button
        className="mt-6 h-11 w-full gap-2 rounded-xl"
        type="submit"
        variant="cta"
        disabled={!built.ok || disabled || (isGraphic && !graphicReady)}
      >
        {createMutation.isPending ? "프로젝트를 만드는 중..." : "프로젝트 만들기"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      {error ? (
        <p role="alert" className="mt-3 text-center text-xs text-destructive">{error}</p>
      ) : (
        <p aria-live="polite" className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
          {built.ok
            ? "만든 뒤 요청을 입력하면 AI와 작업을 시작해요."
            : PROBLEM_MESSAGE[built.problem]}
        </p>
      )}
    </form>
  );
}
