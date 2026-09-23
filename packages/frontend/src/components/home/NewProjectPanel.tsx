import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/t";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { createProject, detectBackends } from "@/api/home";
import { backendLabel, graphicBackendId } from "@/lib/backend-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProjectBriefFields, {
  ToggleRow,
} from "@/components/home/ProjectBriefFields";
import { GraphicCanvasFields } from "@/components/home/GraphicCanvasFields";
import { GraphicSetFields } from "@/components/home/GraphicSetFields";
import { LogoSetFields } from "@/components/home/LogoSetFields";
import DesignSystemPicker from "./DesignSystemPicker";
import { apiErrorCopy } from "@/lib/error-copy";
import { readCreationDraft, writeCreationDraft } from "@/lib/creation-draft";
import {
  INITIAL_BRIEF_FORM,
  draftProblemMessage,
  PROJECT_CONTROL_CLASS,
  PROJECT_LABEL_CLASS,
  PROTOTYPE_PAGE_PRESETS,
  buildCreateProjectRequest,
  keepSelectedDesignSystemId,
  isOriginalSampleSystem,
  requiresImageBackend,
  selectableDesignSystems,
  type BriefForm,
} from "@/lib/project-creation";
import ComposerAttachments from "@/components/chat/ComposerAttachments";
import { hasPaginatedContentSource, planAttachmentIntake, setAttachmentRole, COMPOSER_SUPPORTED_EXTENSIONS, type IntakeItem } from "@/components/chat/attachment-intake";
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
  const t = useT();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [backendId, setBackendId] = useState<BackendId>(defaultBackend);
  const detection = useQuery({ queryKey: ["backends", "detect"], queryFn: detectBackends });
  const [templateFormat, setTemplateFormat] = useState<"prototype" | "slide_deck" | "graphic">("prototype");
  const [generationByBackend, setGenerationByBackend] = useState(generationDefaults ?? {});
  const [form, setForm] = useState<BriefForm>(() => readCreationDraft(type));
  const draftTypeRef = useRef(type);
  const [pickedSystemId, setPickedSystemId] = useState<string | null>(null);
  const [choosingSystem, setChoosingSystem] = useState(false);
  const [withoutSystem, setWithoutSystem] = useState(false);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const wasChoosingRef = useRef(false);
  const [items, setItems] = useState<readonly IntakeItem[]>([]);
  const [error, setError] = useState<Error | null>(null);

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
  const isLogo = effectiveType === "logo";
  // Both formats are drawn with the image tool, so both pin the backend to a
  // draw-capable one and both wait for that backend to be ready.
  const needsImageBackend = requiresImageBackend(effectiveType);
  const detectedBackends = detection.data?.backends ?? [];
  const effectiveBackend = needsImageBackend ? graphicBackendId(detectedBackends, backendId) : backendId;
  const generation = generationByBackend[effectiveBackend] ?? defaultGenerationOptions(effectiveBackend);

  const createMutation = useMutation({
    mutationFn: (request: CreateProjectRequest) => createProject(request),
    onSuccess: async (created) => {
      try { await saveComposerDraft(created.session_id, { text: form.objective, items: items.filter((item) => item.status === "ready"), generation }); }
      catch { pushToast({ title: t("home.creation.draftMoved"), body: t("home.creation.storageLimited"), tone: "error" }); }
      setItems([]);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onCreated(created);
      setForm(INITIAL_BRIEF_FORM);
      setPickedSystemId(null);
      setError(null);
    },
    onError: (err) => {
      const message = apiErrorCopy(err);
      setError(err);
      pushToast({
        title: t("home.creation.error"),
        body: message,
        tone: "error",
      });
    },
  });

  const effectiveContentSource = items.some((item) => item.status === "ready") ? "attached" : form.contentSource;
  const canMapSourcePages = hasPaginatedContentSource(items);
  const built = buildCreateProjectRequest(
    { ...form, sourcePageMapping: canMapSourcePages ? form.sourcePageMapping : "restructure", contentSource: effectiveContentSource, type: effectiveType, backendId: effectiveBackend, designSystemId: pickedSystemId, ...(isOriginal && isGraphic ? { graphicWidth: 1080, graphicHeight: 1350 } : {}) },
    designSystems,
  );
  const disabled = createMutation.isPending;
  const needsSystemChoice = !designSystemId && (!withoutSystem || isTemplate || pickedSystemId !== null);
  const canContinue = built.ok || (!built.ok && (built.problem === "design_system_required" || built.problem === "design_system_not_selectable"));

  useEffect(() => {
    setChoosingSystem(false);
    setPickedSystemId(null);
    setWithoutSystem(false);
  }, [type]);

  useEffect(() => {
    if (wasChoosingRef.current && !choosingSystem) returnFocusRef.current?.focus();
    wasChoosingRef.current = choosingSystem;
  }, [choosingSystem]);

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

  if (choosingSystem) return <DesignSystemPicker
    projectType={isTemplate ? templateFormat : type}
    systems={selectable} selectedId={designSystemId} loading={systemsLoading} error={systemsError} allowNone={!isTemplate}
    onSelect={setPickedSystemId} onRefresh={onRetrySystems} onBack={() => setChoosingSystem(false)}
    onApply={(id) => { setPickedSystemId(id); setWithoutSystem(id === null); setChoosingSystem(false); }}
  />;

  return (
    <form className="p-6" onSubmit={(event) => {
      event.preventDefault();
      if (!canContinue || disabled || (needsImageBackend && !graphicReady)) return;
      if (needsSystemChoice) { setChoosingSystem(true); return; }
      if (!built.ok || (designSystemId && (systemsLoading || systemsError))) return;
      setError(null);
      createMutation.mutate(built.request);
    }}>
      <h2 className="mb-3 text-xs font-semibold text-muted-foreground">{t("home.creation.basics")}</h2>

      <div className="space-y-4">
        <div className="space-y-2"><label htmlFor="creation-backend" className={PROJECT_LABEL_CLASS}>{t("home.creation.aiTool")}</label><select id="creation-backend" className={PROJECT_CONTROL_CLASS} value={effectiveBackend} disabled={disabled || needsImageBackend} onChange={(event) => setBackendId(event.target.value as BackendId)}>{(detectedBackends.length > 0 ? detectedBackends : [{ id: "claude-code" as BackendId, found: true }, { id: "codex" as BackendId, found: true }]).map((backend) => <option key={backend.id} value={backend.id} disabled={!backend.found}>{backendLabel(backend.id)}{backend.found ? "" : " —"}</option>)}</select><GenerationControls backendId={effectiveBackend} value={generation} disabled={disabled} onChange={(value) => setGenerationByBackend((current) => ({ ...current, [effectiveBackend]: value }))} /></div>
        <div className="space-y-1.5">
          <label htmlFor="project-name" className={PROJECT_LABEL_CLASS}>
            {t("home.creation.name")}
          </label>
          <Input
            id="project-name"
            placeholder={t("home.creation.namePlaceholder")}
            value={form.name}
            autoFocus
            required
            disabled={disabled}
            onChange={(e) => update("name", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="design-system" className={PROJECT_LABEL_CLASS}>
            {isTemplate ? t("home.creation.template") : t("home.system")}
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
            onChange={(e) => { setPickedSystemId(e.target.value || null); setWithoutSystem(false); }}
            className={PROJECT_CONTROL_CLASS}
          >
            <option value="">
              {systemsLoading
                ? t("home.creation.loading")
                : systemsError
                  ? t("home.creation.loadError")
                  : selectable.length === 0
                    ? isTemplate
                      ? t("home.creation.noTemplates")
                      : t("home.creation.noSystems")
                    : isTemplate
                      ? t("home.creation.selectTemplate")
                      : t(withoutSystem ? "home.creation.noSystem" : "home.picker.later")}
            </option>
            {systemsLoading || systemsError
              ? null
              : selectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
          </select>
          <Button ref={returnFocusRef} type="button" variant="outline" className="w-full" disabled={disabled} onClick={() => setChoosingSystem(true)}>{t("home.picker.browse")}</Button>
          {systemsError ? (
            <button
              type="button"
              onClick={onRetrySystems}
              className="text-xs font-medium text-accent underline underline-offset-2 hover:no-underline"
            >
              {t("home.retry")}
            </button>
          ) : null}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {systemsLoading
            ? t("home.systemsLoading")
            : systemsError
              ? t("home.creation.systemsError")
              : selectable.length === 0
                ? isTemplate ? t("home.creation.noTemplatesHint") : t("home.creation.noSystemsHint")
                : isOriginal
                  ? t("home.creation.originalHint")
                : isTemplate
                  ? t("home.creation.templateHint")
                  : t("home.creation.systemHint")}
        </p>

        {isTemplate && isOriginal && (
          <div className="space-y-1.5">
            <label htmlFor="template-format" className={PROJECT_LABEL_CLASS}>{t("home.creation.format")}</label>
            <select id="template-format" className={PROJECT_CONTROL_CLASS} value={templateFormat} disabled={disabled} onChange={(event) => {
              const value = event.target.value;
              if (value === "prototype" || value === "slide_deck" || value === "graphic") setTemplateFormat(value);
            }}>
              <option value="prototype">{t("home.creation.webPage")}</option>
              <option value="slide_deck">{t("home.creation.slides")}</option>
              <option value="graphic">{t("home.creation.graphicFormat")}</option>
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

        {isLogo && (
          <LogoSetFields
            form={form}
            disabled={disabled}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          />
        )}

        {effectiveType === "prototype" && <>
          <div className="space-y-1.5"><label htmlFor="section-count" className={PROJECT_LABEL_CLASS}>{t("home.creation.sections")}</label><Input id="section-count" type="number" min={1} max={30} step={1} value={form.sectionCount ?? 6} disabled={disabled} onChange={(event) => update("sectionCount", event.target.valueAsNumber)} /><p className="text-xs text-muted-foreground">{t("home.creation.sectionsHint")}</p></div>
          <fieldset className="space-y-2" disabled={disabled}>
            <legend className={PROJECT_LABEL_CLASS}>{t("home.creation.pages")}</legend>
            <div className="flex flex-wrap gap-2">
              {PROTOTYPE_PAGE_PRESETS.map((preset) => {
                const selected = form.pages.includes(preset.relPath);
                return <button key={preset.relPath} type="button" aria-pressed={selected} aria-label={t(selected ? "home.creation.pageRemove" : "home.creation.pageAdd", { name: t(preset.label) })} onClick={() => update("pages", selected ? form.pages.filter((page) => page !== preset.relPath) : [...form.pages, preset.relPath])} className={selected ? "min-h-9 rounded-full border border-accent bg-accent-soft px-3 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "min-h-9 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}>{t(preset.label)}</button>;
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("home.creation.homeIncluded")}</p>
          </fieldset>
        </>}
        <div className="space-y-2"><label htmlFor="project-materials" className={PROJECT_LABEL_CLASS}>{t("home.creation.attach")}</label><input id="project-materials" type="file" multiple accept={COMPOSER_SUPPORTED_EXTENSIONS.join(",")} disabled={disabled} onChange={(event) => { const picked = Array.from(event.target.files ?? []); setItems((current) => planAttachmentIntake(current, picked)); event.target.value = ""; }} className="block w-full text-sm" /><p className="text-xs text-muted-foreground">{t("home.creation.attachHint")}</p><ComposerAttachments items={items} sending={disabled} onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))} onRoleChange={(id, role) => setItems((current) => setAttachmentRole(current, id, role))} /></div>
        <ProjectBriefFields
          form={form}
          disabled={disabled}
          onChange={update}
          showOutputSize={!isGraphic && !isLogo}
        />

        {effectiveType === "slide_deck" && (
          <ToggleRow
            title={t("home.creation.speakerNotes")}
            hint={t("home.creation.speakerNotesHint")}
            checked={form.useSpeakerNotes}
            disabled={disabled}
            onChange={(v) => update("useSpeakerNotes", v)}
          />
        )}

        {effectiveType === "slide_deck" && effectiveContentSource === "attached" && (
          <ToggleRow
            title={t("home.creation.sourcePages")}
            hint={t("home.creation.sourcePagesHint")}
            checked={canMapSourcePages && form.sourcePageMapping !== "restructure"}
            disabled={disabled || !canMapSourcePages}
            onChange={(v) => update("sourcePageMapping", v ? "one_to_one" : "restructure")}
          />
        )}

        {isTemplate && !isOriginal && (
          <ToggleRow
            title={t("home.creation.copyTemplate")}
            hint={t("home.creation.copyTemplateHint")}
            checked={form.copyAsIs}
            disabled={disabled}
            onChange={(v) => update("copyAsIs", v)}
          />
        )}
      </div>

      {needsImageBackend && !graphicReady && <p role="status" className="mt-4 text-sm text-muted-foreground">{t(isLogo ? "home.creation.logoRequired" : "home.creation.graphicRequired")}</p>}
      <Button
        className="mt-6 h-11 w-full gap-2 rounded-xl"
        type="submit"
        variant="cta"
        disabled={!canContinue || disabled || (needsImageBackend && !graphicReady) || (!!designSystemId && (systemsLoading || systemsError !== null))}
      >
        {createMutation.isPending ? t("home.creation.creating") : t(needsSystemChoice ? "home.picker.next" : "home.creation.create")}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      {error ? (
        <p role="alert" className="mt-3 text-center text-xs text-destructive">{apiErrorCopy(error)}</p>
      ) : (
        <p aria-live="polite" className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
          {built.ok
            ? t("home.creation.ready")
            : draftProblemMessage(built.problem)}
        </p>
      )}
    </form>
  );
}
