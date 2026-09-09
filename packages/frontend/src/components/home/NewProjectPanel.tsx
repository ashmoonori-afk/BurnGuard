import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type {
  BackendId,
  CreateProjectRequest,
  CreateProjectResponse,
  DesignSystemSummary,
  ProjectType,
} from "@bg/shared";
import { createProject } from "@/api/home";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProjectBriefFields, {
  ToggleRow,
} from "@/components/home/ProjectBriefFields";
import { GraphicCanvasFields } from "@/components/home/GraphicCanvasFields";
import { apiErrorCopy } from "@/lib/error-copy";
import {
  INITIAL_BRIEF_FORM,
  PROBLEM_MESSAGE,
  PROJECT_CONTROL_CLASS,
  PROJECT_LABEL_CLASS,
  buildCreateProjectRequest,
  keepSelectedDesignSystemId,
  selectableDesignSystems,
  type BriefForm,
} from "@/lib/project-creation";
import { useUIStore } from "@/state/uiStore";

export type { ProjectType };

export default function NewProjectPanel({
  type,
  designSystems,
  defaultBackend,
  systemsLoading,
  systemsError,
  onRetrySystems,
  onPendingChange,
  onCreated,
}: {
  type: ProjectType;
  designSystems: DesignSystemSummary[];
  defaultBackend: BackendId;
  systemsLoading: boolean;
  systemsError: Error | null;
  onRetrySystems: () => void;
  onPendingChange?: (pending: boolean) => void;
  onCreated: (project: CreateProjectResponse) => void;
}) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [form, setForm] = useState<BriefForm>(INITIAL_BRIEF_FORM);
  const [pickedSystemId, setPickedSystemId] = useState<string | null>(null);
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
  const isGraphic = type === "graphic";

  const createMutation = useMutation({
    mutationFn: (request: CreateProjectRequest) => createProject(request),
    onSuccess: async (created) => {
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
    { ...form, type, backendId: defaultBackend, designSystemId },
    designSystems,
  );
  const disabled = createMutation.isPending;

  useEffect(() => {
    onPendingChange?.(disabled);
    return () => onPendingChange?.(false);
  }, [disabled, onPendingChange]);

  function update<K extends keyof BriefForm>(key: K, value: BriefForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form className="p-6" onSubmit={(event) => {
      event.preventDefault();
      if (!built.ok || disabled) return;
      setError(null);
      createMutation.mutate(built.request);
    }}>
      <h2 className="mb-3 text-xs font-semibold text-muted-foreground">02 · 프로젝트 기본 정보</h2>

      <div className="space-y-4">
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
                : isTemplate
                  ? "게시된 디자인 시스템을 템플릿으로 사용할 수 있어요."
                  : "게시된 디자인 시스템만 목록에 나와요. 없이도 시작할 수 있어요."}
        </p>

        {isGraphic && (
          <GraphicCanvasFields
            width={form.graphicWidth}
            height={form.graphicHeight}
            disabled={disabled}
            onChange={(size) => setForm((current) => ({
              ...current,
              graphicWidth: size.width,
              graphicHeight: size.height,
            }))}
          />
        )}

        <ProjectBriefFields
          form={form}
          disabled={disabled}
          onChange={update}
          showOutputSize={!isGraphic}
        />

        {type === "slide_deck" && (
          <ToggleRow
            title="발표자 노트 사용"
            hint="슬라이드 위 글자를 줄여요"
            checked={form.useSpeakerNotes}
            disabled={disabled}
            onChange={(v) => update("useSpeakerNotes", v)}
          />
        )}

        {isTemplate && (
          <ToggleRow
            title="템플릿을 그대로 복사"
            hint="구조는 유지하고 내용만 바꿔요"
            checked={form.copyAsIs}
            disabled={disabled}
            onChange={(v) => update("copyAsIs", v)}
          />
        )}
      </div>

      <Button
        className="mt-6 h-11 w-full gap-2 rounded-xl"
        type="submit"
        variant="cta"
        disabled={!built.ok || disabled}
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
