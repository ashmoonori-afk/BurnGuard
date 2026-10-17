import { useEffect, useRef, useState, type MutableRefObject } from "react";
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
import { sendUserEvent } from "@/api/session";
import { logoIdeationMessage } from "@/lib/logo-project";
import { backendOptionLabel, backendSelectState, graphicBackendId } from "@/lib/backend-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProjectBriefFields, {
  ToggleRow,
} from "@/components/home/ProjectBriefFields";
import { GraphicCanvasFields } from "@/components/home/GraphicCanvasFields";
import { GraphicSetFields } from "@/components/home/GraphicSetFields";
import { LogoSetFields } from "@/components/home/LogoSetFields";
import DesignSystemPicker, { PickerThumbnail } from "./DesignSystemPicker";
import { filterHomeCards, systemToCard } from "./mappers";
import { apiErrorCopy } from "@/lib/error-copy";
import { clearCreationDraft, readCreationDraft, writeCreationDraft } from "@/lib/creation-draft";
import { manualCanvasPatch } from "@/lib/graphic-set-form";
import {
  INITIAL_BRIEF_FORM,
  AUDIENCE_MAX_LENGTH,
  OBJECTIVE_MAX_LENGTH,
  suggestedProjectName,
  draftProblemMessage,
  PROJECT_CONTROL_CLASS,
  PROJECT_LABEL_CLASS,
  PROJECT_SECTION_CLASS,
  PROTOTYPE_PAGE_PRESETS,
  buildCreateProjectRequest,
  coerceBriefChoice,
  contentSourceChoicesFor,
  keepSelectedDesignSystemId,
  isOriginalSampleSystem,
  outputSizeChoicesFor,
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
  guided = false,
  graphicReady = false,
  generationDefaults,
  systemsLoading,
  systemsError,
  onRetrySystems,
  onPendingChange,
  onChoosingChange,
  backRef,
  onCreated,
}: {
  type: ProjectType;
  designSystems: DesignSystemSummary[];
  defaultBackend: BackendId;
  guided?: boolean;
  graphicReady?: boolean;
  generationDefaults?: Partial<Record<BackendId, GenerationOptions>>;
  systemsLoading: boolean;
  systemsError: Error | null;
  onRetrySystems: () => void;
  onPendingChange?: (pending: boolean) => void;
  /** Reports whether the design-system picker is showing, so the host dialog can route Escape to `backRef`. */
  onChoosingChange?: (choosing: boolean) => void;
  /** Filled with the picker's back step while it is showing; null otherwise. */
  backRef?: MutableRefObject<(() => void) | null>;
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
  const submitting = useRef(false);
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
  const backendSelect = backendSelectState(detection);
  const detectedBackends = backendSelect.backends;
  const effectiveBackend = needsImageBackend ? graphicBackendId(detectedBackends, backendId) : backendId;
  const generation = generationByBackend[effectiveBackend] ?? defaultGenerationOptions(effectiveBackend, detectedBackends.find((backend) => backend.id === effectiveBackend)?.models);

  const createMutation = useMutation({
    mutationFn: (request: CreateProjectRequest) => createProject(request),
    onSuccess: async (created, request) => {
      const readyItems = items.filter((item) => item.status === "ready");
      const text = request.options?.design_brief?.objective ?? form.objective.trim();
      try { await saveComposerDraft(created.session_id, { text, items: readyItems, generation }); }
      catch { pushToast({ title: t("home.creation.draftMoved"), body: t("home.creation.storageLimited"), tone: "error" }); }
      if (text.trim() || readyItems.length > 0) {
        try {
          await sendUserEvent(created.session_id, {
            type: "user.message",
            text: request.type === "logo" ? logoIdeationMessage(text) : text,
            files: readyItems.map((item) => ({ id: item.id, file: item.file, role: item.role })),
            generation,
          });
          try { await saveComposerDraft(created.session_id, { text: "", items: [], generation }); }
          catch { pushToast({ title: t("home.creation.draftMoved"), body: t("home.creation.storageLimited"), tone: "error" }); }
        } catch (sendError) {
          pushToast({ title: t("home.creation.firstSendFailed"), body: apiErrorCopy(sendError), tone: "error" });
        }
      }
      setItems([]);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      clearCreationDraft(type);
      onCreated(created);
      setForm(INITIAL_BRIEF_FORM);
      setPickedSystemId(null);
      setError(null);
    },
    onSettled: () => { submitting.current = false; },
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

  // The brief offers only what the effective type supports; a draft value from
  // another type falls back to the first offered choice.
  const contentSourceChoices = contentSourceChoicesFor(effectiveType, isTemplate);
  const outputSizeChoices = outputSizeChoicesFor(effectiveType);
  const contentSource = coerceBriefChoice(contentSourceChoices, form.contentSource);
  const outputSize = coerceBriefChoice(outputSizeChoices, form.outputSize);
  const effectiveContentSource = items.some((item) => item.status === "ready") ? "attached" : contentSource;
  const canMapSourcePages = hasPaginatedContentSource(items);
  const built = buildCreateProjectRequest(
    { ...form, sourcePageMapping: canMapSourcePages ? form.sourcePageMapping : "restructure", contentSource: effectiveContentSource, outputSize, type: effectiveType, backendId: effectiveBackend, designSystemId: pickedSystemId, ...(isOriginal && isGraphic ? { graphicWidth: 1080, graphicHeight: 1350 } : {}) },
    designSystems,
  );
  const disabled = createMutation.isPending;
  const suggestions = filterHomeCards(selectable.map((system, index) => systemToCard(system, index, effectiveType)), "").slice(0, 4);
  const canContinue = built.ok || (!built.ok && (built.problem === "design_system_required" || built.problem === "design_system_not_selectable"));

  useEffect(() => {
    if (wasChoosingRef.current && !choosingSystem) returnFocusRef.current?.focus();
    wasChoosingRef.current = choosingSystem;
  }, [choosingSystem]);

  useEffect(() => {
    onPendingChange?.(disabled);
    return () => onPendingChange?.(false);
  }, [disabled, onPendingChange]);

  useEffect(() => {
    onChoosingChange?.(choosingSystem);
    if (backRef) backRef.current = choosingSystem ? () => setChoosingSystem(false) : null;
    return () => {
      onChoosingChange?.(false);
      if (backRef) backRef.current = null;
    };
  }, [choosingSystem, onChoosingChange, backRef]);

  // What the user typed is a draft: it survives navigation, reload, and a
  // failed create, and each project type keeps its own.
  useEffect(() => {
    if (draftTypeRef.current === type) {
      writeCreationDraft(type, form);
      return;
    }
    draftTypeRef.current = type;
    setChoosingSystem(false);
    setPickedSystemId(null);
    setForm(readCreationDraft(type));
  }, [form, type]);

  function update<K extends keyof BriefForm>(key: K, value: BriefForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const nameField = (
        <div className="space-y-1.5">
          <label htmlFor="project-name" className={PROJECT_LABEL_CLASS}>
            {t("home.creation.name")}
          </label>
          <Input
            id="project-name"
            placeholder={t("home.creation.namePlaceholder")}
            value={form.name || suggestedProjectName(form.objective)}
            disabled={disabled}
            onChange={(e) => update("name", e.target.value)}
          />
        </div>
  );
  const audienceField = (
        <div className="space-y-1.5">
          <label htmlFor="brief-audience" className={PROJECT_LABEL_CLASS}>{t("home.brief.audience")}</label>
          <Input id="brief-audience" maxLength={AUDIENCE_MAX_LENGTH} value={form.audience} disabled={disabled}
            placeholder={t("home.brief.audiencePlaceholder")} onChange={(event) => update("audience", event.target.value)} />
        </div>

  );
  const materialsField = (
        <div className="space-y-2"><label htmlFor="project-materials" className={PROJECT_LABEL_CLASS}>{t("home.creation.attach")}</label><input id="project-materials" type="file" multiple accept={COMPOSER_SUPPORTED_EXTENSIONS.join(",")} disabled={disabled} onChange={(event) => { const picked = Array.from(event.target.files ?? []); setItems((current) => planAttachmentIntake(current, picked)); event.target.value = ""; }} className="block w-full text-sm" /><p className="text-xs text-muted-foreground">{t("home.creation.attachHint")}</p><ComposerAttachments items={items} sending={disabled} onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))} onRoleChange={(id, role) => setItems((current) => setAttachmentRole(current, id, role))} /></div>
  );
  if (choosingSystem) return <div className="min-h-0 flex-1 overflow-y-auto"><DesignSystemPicker
    projectType={isTemplate ? templateFormat : type}
    systems={selectable} selectedId={designSystemId} loading={systemsLoading} error={systemsError} allowNone={!isTemplate}
    onSelect={setPickedSystemId} onRefresh={onRetrySystems} onBack={() => setChoosingSystem(false)}
    onApply={(id) => { setPickedSystemId(id); setChoosingSystem(false); }}
  /></div>;

  return (
    <form className={guided ? "[&_select]:min-h-11" : "flex min-h-0 flex-1 flex-col"} onSubmit={(event) => {
      event.preventDefault();
      if (!canContinue || disabled || submitting.current || (needsImageBackend && !graphicReady)) return;
      if (!built.ok || (designSystemId && (systemsLoading || systemsError))) return;
      submitting.current = true;
      setError(null);
      createMutation.mutate(built.request);
    }}>
      <div className={guided ? "" : "min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-5"}>
      {!guided && <h2 className={`mb-3 ${PROJECT_SECTION_CLASS}`}>{t("home.creation.basics")}</h2>}

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="brief-objective" className={PROJECT_LABEL_CLASS}>{t("home.brief.objective")}</label>
          <textarea id="brief-objective" rows={4} required maxLength={OBJECTIVE_MAX_LENGTH}
            placeholder={t("home.brief.objectivePlaceholder")} value={form.objective} disabled={disabled}
            onChange={(event) => update("objective", event.target.value)}
            className={`${PROJECT_CONTROL_CLASS} h-auto resize-y py-3 leading-relaxed placeholder:text-muted-foreground`} />
        </div>
        <div className="space-y-2"><label htmlFor="creation-backend" className={PROJECT_LABEL_CLASS}>{t("home.creation.aiTool")}</label><select id="creation-backend" className={PROJECT_CONTROL_CLASS} value={backendSelect.placeholder === null ? effectiveBackend : ""} disabled={disabled || needsImageBackend || backendSelect.placeholder !== null} onChange={(event) => setBackendId(event.target.value as BackendId)}>{backendSelect.placeholder === null ? detectedBackends.map((backend) => <option key={backend.id} value={backend.id} disabled={!backend.found}>{backendOptionLabel(backend)}</option>) : <option value="">{t(backendSelect.placeholder)}</option>}</select>{detection.isError ? <p role="alert" className="text-xs text-destructive">{apiErrorCopy(detection.error)} <button type="button" onClick={() => void detection.refetch()} className="font-medium text-accent underline underline-offset-2 hover:no-underline">{t("home.retry")}</button></p> : null}</div>
        {nameField}
        {!guided && audienceField}

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
            onChange={(e) => setPickedSystemId(e.target.value || null)}
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
                      : t("home.creation.noSystem")}
            </option>
            {systemsLoading || systemsError
              ? null
              : selectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
          </select>
          {!guided && !systemsLoading && !systemsError && suggestions.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-qa="creation-suggestions">
            {suggestions.map((card) => <button key={card.id} type="button" disabled={disabled} aria-pressed={designSystemId === card.id}
              onClick={() => setPickedSystemId(card.id)}
              className={`min-w-0 overflow-hidden rounded-lg border border-border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${designSystemId === card.id ? "bg-accent-soft" : "bg-card hover:bg-muted"}`}>
              <span className="flex aspect-video items-center justify-center overflow-hidden bg-muted"><PickerThumbnail source={card.thumbnail} /></span>
              <span className="block break-words p-2 text-xs font-medium">{card.name}</span>
            </button>)}
          </div>}
          {!guided && <Button ref={returnFocusRef} type="button" variant="outline" className="w-full" disabled={disabled} onClick={() => setChoosingSystem(true)}>{t("home.picker.browse")}</Button>}
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

        {!guided && materialsField}
        <details className="rounded-xl border border-border bg-muted/30 p-4" data-qa="creation-advanced">
          <summary className="min-h-6 cursor-pointer rounded-sm py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">{t("home.brief.details")}</summary>
          <div className="mt-4 space-y-4">
            {guided && <>{audienceField}{materialsField}</>}
            <GenerationControls backendId={effectiveBackend} value={generation} disabled={disabled} onChange={(value) => setGenerationByBackend((current) => ({ ...current, [effectiveBackend]: value }))} />
        {isGraphic && (
          <GraphicCanvasFields
            width={isOriginal ? 1080 : form.graphicWidth}
            height={isOriginal ? 1350 : form.graphicHeight}
            disabled={disabled || isOriginal}
            onChange={(size) => setForm((current) => ({ ...current, ...manualCanvasPatch(size) }))}
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
        <ProjectBriefFields
          form={{ ...form, contentSource, outputSize }}
          disabled={disabled}
          onChange={update}
          contentSourceChoices={contentSourceChoices}
          outputSizeChoices={outputSizeChoices}
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
        </details>
      </div>

      </div>
      <div className={guided ? "mt-5" : "shrink-0 border-t border-border bg-card px-6 py-4"}>
      {needsImageBackend && !graphicReady && <p role="status" className="mb-3 text-sm text-muted-foreground">{t(isLogo ? "home.creation.logoRequired" : "home.creation.graphicRequired")}</p>}
      <Button
        data-qa="creation-submit"
        className="h-11 w-full gap-2 rounded-xl"
        type="submit"
        variant="cta"
        disabled={!canContinue || disabled || (needsImageBackend && !graphicReady) || (!!designSystemId && (systemsLoading || systemsError !== null))}
      >
        {createMutation.isPending ? t("home.creation.creating") : t("home.creation.create")}
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
      </div>
    </form>
  );
}
