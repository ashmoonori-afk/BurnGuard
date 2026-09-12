import { useRef, useState } from "react";
import { useT, type MessageKey } from "@/i18n/t";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Blocks, Image, LayoutTemplate, Plus, Presentation, Search } from "lucide-react";
import type { ProjectType } from "@bg/shared";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  deleteDesignSystem,
  extractDesignSystem,
  uploadDesignSystem,
} from "@/api/design-system";
import { ApiError } from "@/api/client";
import {
  deleteProject,
  detectBackends,
  getSettings,
  listDesignSystems,
  listProjects,
  restoreSamples,
} from "@/api/home";
import CardGrid from "@/components/home/CardGrid";
import {
  filterHomeCards,
  projectToCard,
  systemToCard,
  type CardViewModel,
} from "@/components/home/mappers";
import ProjectCardSection from "@/components/home/ProjectCardSection";
import ProjectCard from "@/components/home/ProjectCard";
import ProjectImportDialog from "@/components/home/ProjectImportDialog";
import NewProjectPanel from "@/components/home/NewProjectPanel";
import PinterestImportDialog from "@/components/home/PinterestImportDialog";
import DeleteDesignSystemDialog from "@/components/home/DeleteDesignSystemDialog";
import DeleteProjectDialog from "@/components/home/DeleteProjectDialog";
import CliMissingModal from "@/components/errors/CliMissingModal";
import { apiErrorCopy } from "@/lib/error-copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useUIStore } from "@/state/uiStore";

type HomeTab = "recent" | "mine" | "examples" | "systems";
type SystemImportMode = "url" | "upload";

const PROJECT_TYPES = [
  { id: "slide_deck", label: "home.type.slide_deck", description: "home.type.slideDescription", icon: Presentation, color: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  { id: "prototype", label: "home.type.prototype", description: "home.type.webDescription", icon: Blocks, color: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" },
  { id: "graphic", label: "home.type.graphic", description: "home.type.graphicDescription", icon: Image, color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  { id: "from_template", label: "home.type.from_template", description: "home.type.templateDescription", icon: LayoutTemplate, color: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
] as const;

const HOME_TITLES: Record<HomeTab, { title: MessageKey; description: MessageKey }> = {
  recent: { title: "home.title.recent", description: "home.description.recent" },
  mine: { title: "home.title.mine", description: "home.description.mine" },
  examples: { title: "home.title.examples", description: "home.description.examples" },
  systems: { title: "home.title.systems", description: "home.description.systems" },
};

export default function HomeView() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const requestedView = searchParams.get("view");
  const activeTab: HomeTab = requestedView === "mine" || requestedView === "examples" || requestedView === "systems" ? requestedView : "recent";
  const requestedType = searchParams.get("create");
  const creationType: ProjectType | null = requestedType === "other" || PROJECT_TYPES.some((type) => type.id === requestedType) ? requestedType as ProjectType : null;
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectImportOpen, setProjectImportOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [systemQuery, setSystemQuery] = useState("");
  const [systemStatus, setSystemStatus] = useState<"all" | "draft" | "review" | "published">("all");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [cliMissingOpen, setCliMissingOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const lastDeleteProjectName = useRef("");
  const [deleteSystemTarget, setDeleteSystemTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteSystemBlocker, setDeleteSystemBlocker] = useState<
    | { reason: "is_template" }
    | {
        reason: "has_active_projects";
        projects: Array<{ id: string; name: string }>;
      }
    | null
  >(null);
  const [systemImportOpen, setSystemImportOpen] = useState(false);
  const [pinterestImportOpen, setPinterestImportOpen] = useState(false);
  const [systemImportMode, setSystemImportMode] =
    useState<SystemImportMode>("url");
  const [systemSourceUrl, setSystemSourceUrl] = useState("");
  const [systemSourceType, setSystemSourceType] = useState<
    "auto" | "github" | "website" | "figma"
  >("auto");
  const [systemDraftName, setSystemDraftName] = useState("");
  const [systemUploadFile, setSystemUploadFile] = useState<File | null>(null);
  const [systemImportError, setSystemImportError] = useState<Error | null>(
    null,
  );

  const recentQuery = useQuery({
    queryKey: ["projects", "recent"],
    queryFn: () => listProjects("recent"),
    enabled: activeTab === "recent",
  });
  const mineQuery = useQuery({
    queryKey: ["projects", "mine"],
    queryFn: () => listProjects("mine"),
    enabled: activeTab === "mine",
  });
  const examplesQuery = useQuery({
    queryKey: ["projects", "examples"],
    queryFn: () => listProjects("examples"),
    enabled: activeTab === "examples",
  });
  const systemsQuery = useQuery({
    queryKey: ["design-systems", "all"],
    queryFn: async () => {
      const [draft, review, published] = await Promise.all([
        listDesignSystems("draft"),
        listDesignSystems("review"),
        listDesignSystems("published"),
      ]);
      return [...draft, ...review, ...published].sort(
        (a, b) => b.updated_at - a.updated_at,
      );
    },
    enabled: activeTab === "systems" || creationType !== null,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings, enabled: creationType !== null });
  const detectionQuery = useQuery({
    queryKey: ["backends", "detect"],
    queryFn: detectBackends,
  });

  const graphicReady = detectionQuery.data?.backends.some((backend) => backend.id === "codex" && backend.found && backend.authenticated === true) ?? false;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      pushToast({ title: t("home.toast.projectDeleted"), tone: "success" });
      setDeleteTarget(null);
    },
    onError: (err) => {
      pushToast({
        title: t("home.toast.projectDeleteError"),
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const restoreSamplesMutation = useMutation({
    mutationFn: () => restoreSamples(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      pushToast({ title: t("home.toast.examplesRestored"), tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: t("home.toast.examplesRestoreError"),
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const deleteSystemMutation = useMutation({
    mutationFn: (id: string) => deleteDesignSystem(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["design-systems"] });
      pushToast({ title: t("home.toast.systemDeleted"), tone: "success" });
      setDeleteSystemTarget(null);
      setDeleteSystemBlocker(null);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "is_template") {
        setDeleteSystemBlocker({ reason: "is_template" });
        return;
      }
      if (err instanceof ApiError && err.code === "has_active_projects") {
        const details = err.details as
          | { project_refs?: Array<{ id: string; name: string }> }
          | null
          | undefined;
        setDeleteSystemBlocker({
          reason: "has_active_projects",
          projects: details?.project_refs ?? [],
        });
        return;
      }
      pushToast({
        title: t("home.toast.systemDeleteError"),
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const importSystemMutation = useMutation({
    mutationFn: async () => {
      if (systemImportMode === "upload") {
        if (!systemUploadFile) {
          throw Object.assign(new Error("Upload file is required"), {
            code: "upload_file_required",
          });
        }
        return await uploadDesignSystem(systemUploadFile, {
          name: systemDraftName.trim() || undefined,
        });
      }

      return await extractDesignSystem({
        source_url: systemSourceUrl.trim(),
        source_type:
          systemSourceType === "auto" ? undefined : systemSourceType,
        name: systemDraftName.trim() || undefined,
      });
    },
    onSuccess: async (created) => {
      setSystemImportError(null);
      setSystemSourceUrl("");
      setSystemDraftName("");
      setSystemUploadFile(null);
      setSystemImportMode("url");
      setSystemImportOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["design-systems"] });
      pushToast({
        title:
          systemImportMode === "upload"
            ? t("home.toast.fileImported")
            : t("home.toast.systemImported"),
        body: t("home.toast.systemDraft", { name: created.system.name }),
        tone: "success",
      });
      navigate(`/systems/${created.system.id}`);
    },
    onError: (err) => {
      const message = apiErrorCopy(err);
      setSystemImportError(err);
      pushToast({
        title: t("home.toast.systemImportError"),
        body: message,
        tone: "error",
      });
    },
  });

  const recentCards = (recentQuery.data ?? []).map(projectToCard);
  const mineCards = (mineQuery.data ?? []).map(projectToCard);
  const exampleCards = (examplesQuery.data ?? []).map(projectToCard);
  const filteredRecentCards = filterHomeCards(recentCards, projectQuery);
  const filteredMineCards = filterHomeCards(mineCards, projectQuery);
  const filteredExampleCards = filterHomeCards(exampleCards, projectQuery);
  const systemCards = filterHomeCards(
    (systemsQuery.data ?? []).filter((system) => systemStatus === "all" || system.status === systemStatus).map(systemToCard),
    systemQuery,
  );

  const onProjectDelete = (card: CardViewModel) => {
    lastDeleteProjectName.current = card.name;
    setDeleteTarget({ id: card.id, name: card.name });
  };

  // Clearing from an empty-result panel removes the button the user is
  // standing on, so focus returns to the search field instead of the
  // document body.
  const clearProjectQuery = () => {
    setProjectQuery("");
    searchInputRef.current?.focus();
  };

  const clearSystemFilters = () => {
    setSystemQuery("");
    setSystemStatus("all");
    searchInputRef.current?.focus();
  };

  const startProject = (type: ProjectType = "slide_deck") => {
    const next = new URLSearchParams(searchParams);
    next.set("create", type);
    setSearchParams(next);
  };
  const closeCreation = () => {
    if (creatingProject) return;
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next);
  };
  const changeView = (view: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", view);
    setSearchParams(next);
  };

  return (
    <>
      <ProjectImportDialog open={projectImportOpen} onOpenChange={setProjectImportOpen} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-7 sm:px-8 sm:pt-10 lg:px-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("home.workspace")}</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[32px] sm:leading-tight">{t(HOME_TITLES[activeTab].title)}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(HOME_TITLES[activeTab].description)}</p>
          </div>
          <div className="flex gap-2"><Button variant="outline" className="h-11" onClick={() => setProjectImportOpen(true)}>{t("home.importProject")}</Button><Button ref={createTriggerRef} variant="cta" className="h-11 gap-2 rounded-xl px-4" onClick={() => startProject()} aria-haspopup="dialog"><Plus className="h-4 w-4" aria-hidden="true" />{t("home.newProject")}</Button></div>
        </div>
        {detectionQuery.data?.backends.every((backend) => !backend.found) ? <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"><p className="text-sm text-muted-foreground">{t("home.aiNotice")}</p><Button variant="outline" size="sm" onClick={() => setCliMissingOpen(true)}>{t("home.aiGuide")}</Button></div> : null}
        {activeTab === "recent" || activeTab === "mine" ? <section aria-label={t("home.quickStart")} className="mb-10 grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 xl:grid-cols-4">
          {PROJECT_TYPES.map(({ id, label, description, icon: Icon, color }) => <button key={id} type="button" onClick={() => startProject(id)} disabled={id === "graphic" && !graphicReady} title={id === "graphic" && !graphicReady ? t("home.codexRequired") : undefined} aria-haspopup="dialog" className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:items-start xl:gap-3">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${color}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t(label)}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(description)}</span></span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-accent" aria-hidden="true" />
          </button>)}
        </section> : null}
        <Tabs
          value={activeTab}
          onValueChange={changeView}
          className="flex flex-1 flex-col"
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <TabsList className="max-[640px]:grid max-[640px]:h-auto max-[640px]:w-full max-[640px]:grid-cols-2">
              <TabsTrigger value="recent">{t("home.recent")}</TabsTrigger>
              <TabsTrigger value="mine">{t("home.title.mine")}</TabsTrigger>
              <TabsTrigger value="examples">{t("home.examples")}</TabsTrigger>
              <TabsTrigger value="systems">{t("home.title.systems")}</TabsTrigger>
            </TabsList>

              <div className="flex w-full max-w-sm gap-2 max-[640px]:max-w-none">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={searchInputRef}
                  type="search"
                  aria-label={activeTab === "systems" ? t("home.searchSystems") : t("home.searchProjects")}
                  placeholder={activeTab === "systems" ? t("home.searchSystems") : t("home.searchProjects")}
                  value={activeTab === "systems" ? systemQuery : projectQuery}
                  onChange={(event) => activeTab === "systems" ? setSystemQuery(event.target.value) : setProjectQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      if (activeTab === "systems") clearSystemFilters();
                      else clearProjectQuery();
                    }
                  }}
                  className="pl-8"
                />
              </div>
              {activeTab === "systems" ? <select aria-label={t("home.systemStatus")} value={systemStatus} onChange={(event) => setSystemStatus(event.target.value as typeof systemStatus)} className="h-9 max-w-32 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="all">{t("home.status.all")}</option><option value="draft">{t("home.status.draft")}</option><option value="review">{t("home.status.review")}</option><option value="published">{t("home.status.published")}</option>
              </select> : null}
              </div>
          </div>

          <div>
            <TabsContent value="recent">
              <ProjectCardSection
                cards={filteredRecentCards}
                sourceCount={recentCards.length}
                query={projectQuery}
                isLoading={recentQuery.isPending}
                error={recentQuery.error}
                emptyText={t("home.empty.recent")}
                emptyHint={t("home.empty.recentHint")}
                onRetry={() => void recentQuery.refetch()}
                onClearQuery={clearProjectQuery}
                onStartProject={() => startProject()}
                onDelete={onProjectDelete}
              />
            </TabsContent>

            <TabsContent value="mine">
              <ProjectCardSection
                cards={filteredMineCards}
                sourceCount={mineCards.length}
                query={projectQuery}
                isLoading={mineQuery.isPending}
                error={mineQuery.error}
                emptyText={t("home.empty.mine")}
                emptyHint={t("home.empty.mineHint")}
                onRetry={() => void mineQuery.refetch()}
                onClearQuery={clearProjectQuery}
                onStartProject={() => startProject()}
                onDelete={onProjectDelete}
              />
            </TabsContent>

            <TabsContent value="examples">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                  {t("home.examplesHint")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restoreSamplesMutation.isPending}
                  onClick={() => restoreSamplesMutation.mutate()}
                >
                  {restoreSamplesMutation.isPending
                    ? t("home.restoring")
                    : t("home.restoreExamples")}
                </Button>
              </div>
              <ProjectCardSection
                cards={filteredExampleCards}
                sourceCount={exampleCards.length}
                query={projectQuery}
                isLoading={examplesQuery.isPending}
                error={examplesQuery.error}
                emptyText={t("home.empty.examples")}
                emptyHint={t("home.empty.examplesHint")}
                onRetry={() => void examplesQuery.refetch()}
                onClearQuery={clearProjectQuery}
                onStartProject={() => startProject()}
                onDelete={onProjectDelete}
              />
            </TabsContent>

            <TabsContent value="systems">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div><h2 className="text-sm font-semibold">{t("home.pinMood")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("home.pinMoodHint")}</p></div>
                <Button variant="outline" onClick={() => setPinterestImportOpen(true)}>{t("home.importPinterest")}</Button>
              </div>
              <SystemsSection
                cards={systemCards}
                hasFilters={systemQuery.trim().length > 0 || systemStatus !== "all"}
                onClearFilters={clearSystemFilters}
                isLoading={systemsQuery.isPending}
                error={systemsQuery.error}
                onRetry={() => void systemsQuery.refetch()}
                importOpen={systemImportOpen}
                importMode={systemImportMode}
                sourceUrl={systemSourceUrl}
                sourceType={systemSourceType}
                draftName={systemDraftName}
                uploadFile={systemUploadFile}
                importError={systemImportError}
                isPending={importSystemMutation.isPending}
                onToggleImport={() => {
                  setSystemImportOpen((prev) => !prev);
                  setSystemImportError(null);
                }}
                onImportModeChange={setSystemImportMode}
                onSourceUrlChange={setSystemSourceUrl}
                onSourceTypeChange={setSystemSourceType}
                onDraftNameChange={setSystemDraftName}
                onUploadFileChange={setSystemUploadFile}
                onImport={() => importSystemMutation.mutate()}
                onSystemDelete={(card) => {
                  setDeleteSystemBlocker(null);
                  setDeleteSystemTarget({ id: card.id, name: card.name });
                }}
              />
            </TabsContent>
          </div>
        </Tabs>
        </div>
      </div>

      <Dialog open={creationType !== null} onOpenChange={(open) => { if (!open) closeCreation(); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-2xl gap-0 p-0" hideClose={creatingProject} onEscapeKeyDown={(event) => { if (creatingProject) event.preventDefault(); }} onInteractOutside={(event) => { if (creatingProject) event.preventDefault(); }} onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById("project-name")?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); createTriggerRef.current?.focus(); }}>
          <DialogHeader className="border-b border-border px-6 pb-5 pt-6">
            <DialogTitle className="text-xl">{t("home.createTitle")}</DialogTitle>
            <DialogDescription className="pt-1 leading-6">{t("home.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="px-6 pt-5">
            <p id="project-type-label" className="mb-2 text-xs font-semibold text-muted-foreground">{t("home.createType")}</p>
            <div role="group" aria-labelledby="project-type-label" className="flex flex-wrap gap-2">
              {[...PROJECT_TYPES, { id: "other" as const, label: "home.type.other" as const }].map((type) => <button key={type.id} type="button" disabled={creatingProject || (type.id === "graphic" && !graphicReady)} aria-pressed={creationType === type.id} onClick={() => { const next = new URLSearchParams(searchParams); next.set("create", type.id); setSearchParams(next, { replace: true }); }} className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${creationType === type.id ? "border-accent bg-accent/10 text-accent" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}>{t(type.label)}</button>)}
            </div>
            {!graphicReady && <p className="mt-2 text-xs text-muted-foreground">{t("home.graphicAvailability")}</p>}
          </div>
          {settingsQuery.isPending ? <p role="status" className="p-6 text-sm text-muted-foreground">{t("home.settingsLoading")}</p> : settingsQuery.isError ? <div role="alert" className="space-y-3 p-6"><p className="text-sm text-destructive">{t("home.settingsError")}</p><Button variant="outline" onClick={() => void settingsQuery.refetch()}>{t("home.settingsRetry")}</Button></div> : creationType !== null ? <NewProjectPanel generationDefaults={settingsQuery.data.generation_defaults} graphicReady={graphicReady} type={creationType} designSystems={systemsQuery.data ?? []} defaultBackend={settingsQuery.data.default_backend} systemsLoading={systemsQuery.isPending} systemsError={systemsQuery.error} onRetrySystems={() => void systemsQuery.refetch()} onPendingChange={setCreatingProject} onCreated={(project) => navigate(`/projects/${project.id}`)} /> : null}
        </DialogContent>
      </Dialog>

      <PinterestImportDialog open={pinterestImportOpen} onOpenChange={setPinterestImportOpen} onCreated={(result) => {
        void queryClient.invalidateQueries({ queryKey: ["design-systems"] });
        const unavailable = result.pins.filter((pin) => pin.status === "unavailable").length;
        pushToast({ tone: unavailable ? "warn" : "success", title: unavailable ? t("home.toast.moodPartial", { count: unavailable }) : t("home.toast.moodCreated") });
        navigate(`/systems/${result.system.id}`);
      }} />

      {detectionQuery.data ? (
        <CliMissingModal
          open={cliMissingOpen}
          onOpenChange={setCliMissingOpen}
          detection={detectionQuery.data}
        />
      ) : null}

      <DeleteProjectDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTarget(null);
        }}
        projectName={deleteTarget?.name ?? lastDeleteProjectName.current}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        isPending={deleteMutation.isPending}
      />

      <DeleteDesignSystemDialog
        open={deleteSystemTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSystemMutation.isPending) {
            setDeleteSystemTarget(null);
            setDeleteSystemBlocker(null);
          }
        }}
        systemName={deleteSystemTarget?.name ?? ""}
        blocker={deleteSystemBlocker}
        onConfirm={() => {
          if (deleteSystemTarget) {
            deleteSystemMutation.mutate(deleteSystemTarget.id);
          }
        }}
        isPending={deleteSystemMutation.isPending}
      />
    </>
  );
}

function SystemsSection({
  cards,
  hasFilters,
  onClearFilters,
  isLoading,
  error,
  onRetry,
  importOpen,
  importMode,
  sourceUrl,
  sourceType,
  draftName,
  uploadFile,
  importError,
  isPending,
  onToggleImport,
  onImportModeChange,
  onSourceUrlChange,
  onSourceTypeChange,
  onDraftNameChange,
  onUploadFileChange,
  onImport,
  onSystemDelete,
}: {
  cards: readonly CardViewModel[];
  hasFilters: boolean;
  onClearFilters: () => void;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  importOpen: boolean;
  importMode: SystemImportMode;
  sourceUrl: string;
  sourceType: "auto" | "github" | "website" | "figma";
  draftName: string;
  uploadFile: File | null;
  importError: Error | null;
  isPending: boolean;
  onToggleImport: () => void;
  onImportModeChange: (value: SystemImportMode) => void;
  onSourceUrlChange: (value: string) => void;
  onSourceTypeChange: (
    value: "auto" | "github" | "website" | "figma",
  ) => void;
  onDraftNameChange: (value: string) => void;
  onUploadFileChange: (value: File | null) => void;
  onImport: () => void;
  onSystemDelete: (card: CardViewModel) => void;
}) {
  const t = useT();
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  // Match the backend MAX_UPLOAD_BYTES guard in design-system-extract.ts
  // so the user sees the size ceiling client-side instead of getting
  // "invalid_upload" back after the multipart round-trip.
  const MAX_UPLOAD_BYTES = 48_000_000;
  const uploadTooLarge =
    importMode === "upload" && uploadFile !== null && uploadFile.size > MAX_UPLOAD_BYTES;
  const canImport =
    importMode === "upload"
      ? uploadFile !== null && !uploadTooLarge && !isPending
      : sourceUrl.trim().length > 0 && !isPending;

  return (
    <div className="space-y-4">
      <div className="max-w-3xl rounded-xl border border-border bg-card/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
        {t("home.systemsIntro")}
      </div>

      <CardGrid>
        <button
          ref={importTriggerRef}
          type="button"
          onClick={onToggleImport}
          aria-haspopup="dialog"
          className="overflow-hidden rounded-2xl border border-dashed border-border bg-card text-left transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="grid aspect-[16/10] place-items-center border-b border-border bg-accent/5 text-accent">
            <div className="grid place-items-center gap-2">
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-current/20 bg-card">
                <Plus className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="text-xs font-medium tracking-[0.16em]">
                {t("home.import")}
              </div>
            </div>
          </div>
          <div className="p-4">
            <div className="text-sm font-semibold text-foreground">
              {t("home.importSystem")}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {t("home.importSystemSources")}
            </div>
          </div>
        </button>

        {isLoading || error !== null
          ? null
          : cards.map((card) => (
              <ProjectCard
                key={card.id}
                {...card}
                onDelete={() => onSystemDelete(card)}
              />
            ))}
      </CardGrid>

      {!isLoading && error === null && hasFilters ? <p role="status" className="text-sm text-muted-foreground">{t("home.searchCount", { count: cards.length })} <button type="button" onClick={onClearFilters} className="ml-2 font-medium text-accent underline underline-offset-2">{t("home.clearFilters")}</button></p> : null}

      {isLoading ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-dashed border-border bg-card/50 p-16 text-center"
        >
          <p className="text-sm font-medium text-foreground">
            {t("home.systemsLoading")}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("home.wait")}
          </p>
        </div>
      ) : error !== null ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-10 text-center"
        >
          <p className="text-sm font-medium text-foreground">
            {t("home.systemsError")}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("home.serverRetry")}
          </p>
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            {t("home.retry")}
          </Button>
        </div>
      ) : cards.length === 0 ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 text-sm leading-6 text-muted-foreground"
        >
            {hasFilters ? t("home.empty.systemFilters") : t("home.empty.systems")}
        </div>
      ) : null}

      <Dialog open={importOpen} onOpenChange={(open) => { if (!open && !isPending) onToggleImport(); }}>
        <DialogContent id="system-import-panel" className="w-[calc(100%-2rem)] max-w-3xl" hideClose={isPending} onEscapeKeyDown={(event) => { if (isPending) event.preventDefault(); }} onInteractOutside={(event) => { if (isPending) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); importTriggerRef.current?.focus(); }}>
          <DialogHeader>
          <DialogTitle>
            {t("home.importSystem")}
          </DialogTitle>
          <DialogDescription className="pt-1 leading-6">
            {t("home.importSystemDescription")}
          </DialogDescription>
          </DialogHeader>

          <div className="mt-4 inline-flex rounded-lg border border-border bg-background p-1">
            <button
              type="button"
              onClick={() => onImportModeChange("url")}
              aria-pressed={importMode === "url"}
              disabled={isPending}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                importMode === "url"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("home.importUrl")}
            </button>
            <button
              type="button"
              onClick={() => onImportModeChange("upload")}
              aria-pressed={importMode === "upload"}
              disabled={isPending}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                importMode === "upload"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("home.uploadFile")}
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {importMode === "url" ? (
              <>
                <div className="md:col-span-2">
                  <label
                    htmlFor="system-source-url"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("home.sourceUrl")}
                  </label>
                  <Input
                    id="system-source-url"
                    value={sourceUrl}
                    onChange={(e) => onSourceUrlChange(e.target.value)}
                    placeholder="https://github.com/acme/design-system"
                    disabled={isPending}
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <label
                    htmlFor="system-source-type"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("home.sourceType")}
                  </label>
                  <select
                    id="system-source-type"
                    value={sourceType}
                    onChange={(e) =>
                      onSourceTypeChange(
                        e.target.value as
                          | "auto"
                          | "github"
                          | "website"
                          | "figma",
                      )
                    }
                    disabled={isPending}
                    className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
                  >
                    <option value="auto">{t("home.source.auto")}</option>
                    <option value="github">{t("home.source.git")}</option>
                    <option value="website">{t("home.source.website")}</option>
                    <option value="figma">{t("home.source.figma")}</option>
                  </select>
                  {sourceType === "figma" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("home.figmaTokenHint")}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="md:col-span-2">
                  <label
                    htmlFor="system-upload-file"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("home.fileToUpload")}
                  </label>
                  <input
                    id="system-upload-file"
                    type="file"
                    accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    disabled={isPending}
                    onChange={(e) =>
                      onUploadFileChange(e.currentTarget.files?.[0] ?? null)
                    }
                    className="mt-1.5 block h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent/10 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-accent"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("home.uploadLimits")}
                    {uploadFile
                      ? t("home.selectedFile", { name: uploadFile.name, size: formatBytes(uploadFile.size) })
                      : ""}
                  </p>
                  {uploadTooLarge && uploadFile ? (
                    <p className="mt-1 text-xs text-destructive">
                      {t("home.uploadTooLarge", { name: uploadFile.name, size: formatBytes(uploadFile.size) })}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
                  {t("home.documentExtractHint")}
                </div>
              </>
            )}

            <div className="md:col-span-2">
              <label
                htmlFor="system-draft-name"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("home.draftName")}
              </label>
              <Input
                id="system-draft-name"
                value={draftName}
                onChange={(e) => onDraftNameChange(e.target.value)}
                placeholder={t("home.draftNamePlaceholder")}
                disabled={isPending}
                className="mt-1.5"
              />
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
              {t("home.importNextHint")}
            </div>
          </div>

          {importError ? (
            <p role="alert" className="mt-3 text-xs text-destructive">{apiErrorCopy(importError)}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <Button variant="cta" disabled={!canImport} onClick={onImport}>
              {isPending
                ? importMode === "upload"
                  ? t("home.uploading")
                  : t("home.importing")
                : importMode === "upload"
                  ? t("home.uploadDesignFile")
                  : t("home.importSystem")}
            </Button>
            <Button variant="outline" disabled={isPending} onClick={onToggleImport}>
              {t("home.cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Format a byte count as a human-readable "MB" / "KB" string. Rounds
 * to one decimal place for MB so a 47.3 MB file reads precisely next
 * to the 48 MB ceiling.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const mb = bytes / 1_000_000;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1_000;
  if (kb >= 1) return `${kb.toFixed(0)} KB`;
  return `${bytes} B`;
}
