import { useRef, useState } from "react";
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
  { id: "slide_deck", label: "슬라이드 덱", description: "이야기가 선명한 발표 자료", icon: Presentation, color: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  { id: "prototype", label: "웹디자인", description: "직접 눌러보는 웹과 앱 화면", icon: Blocks, color: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" },
  { id: "graphic", label: "그래픽", description: "목적에 맞는 포스터와 이미지", icon: Image, color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  { id: "from_template", label: "템플릿", description: "준비된 스타일에서 빠르게 시작", icon: LayoutTemplate, color: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
] as const;

const HOME_TITLES: Record<HomeTab, { title: string; description: string }> = {
  recent: { title: "무엇을 만들어 볼까요?", description: "아이디어를 시작하거나, 이어서 작업할 프로젝트를 열어 보세요." },
  mine: { title: "내 프로젝트", description: "직접 만든 작업을 한곳에서 찾고 이어서 다듬어요." },
  examples: { title: "예제로 시작하기", description: "실제 작업을 열어 보고, 만드는 흐름을 익혀 보세요." },
  systems: { title: "디자인 시스템", description: "색상과 글꼴을 모아 일관된 스타일로 작업해요." },
};

export default function HomeView() {
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
  const [projectQuery, setProjectQuery] = useState("");
  const [systemQuery, setSystemQuery] = useState("");
  const [systemStatus, setSystemStatus] = useState<"all" | "draft" | "review" | "published">("all");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [cliMissingOpen, setCliMissingOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
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
  const [systemImportError, setSystemImportError] = useState<string | null>(
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
      pushToast({ title: "프로젝트를 삭제했어요", tone: "success" });
      setDeleteTarget(null);
    },
    onError: (err) => {
      pushToast({
        title: "프로젝트를 삭제하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const restoreSamplesMutation = useMutation({
    mutationFn: () => restoreSamples(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      pushToast({ title: "기본 예제를 복원했어요", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "예제를 복원하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const deleteSystemMutation = useMutation({
    mutationFn: (id: string) => deleteDesignSystem(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["design-systems"] });
      pushToast({ title: "디자인 시스템을 삭제했어요", tone: "success" });
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
        title: "디자인 시스템을 삭제하지 못했어요",
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
            ? "디자인 파일을 가져왔어요"
            : "디자인 시스템을 가져왔어요",
        body: `${created.system.name} 초안을 만들었어요. 내용을 확인한 뒤 게시할 수 있어요.`,
        tone: "success",
      });
      navigate(`/systems/${created.system.id}`);
    },
    onError: (err) => {
      const message = apiErrorCopy(err);
      setSystemImportError(message);
      pushToast({
        title: "디자인 시스템을 가져오지 못했어요",
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

  const onProjectDelete = (card: CardViewModel) =>
    setDeleteTarget({ id: card.id, name: card.name });

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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-7 sm:px-8 sm:pt-10 lg:px-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">나의 작업 공간</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[32px] sm:leading-tight">{HOME_TITLES[activeTab].title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{HOME_TITLES[activeTab].description}</p>
          </div>
          <Button ref={createTriggerRef} variant="cta" className="h-11 gap-2 rounded-xl px-4" onClick={() => startProject()} aria-haspopup="dialog"><Plus className="h-4 w-4" aria-hidden="true" />새 프로젝트</Button>
        </div>
        {detectionQuery.data?.backends.every((backend) => !backend.found) ? <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"><p className="text-sm text-muted-foreground">AI와 작업하려면 Claude Code 또는 Codex를 연결해 주세요. 예제와 편집 기능은 먼저 살펴볼 수 있어요.</p><Button variant="outline" size="sm" onClick={() => setCliMissingOpen(true)}>AI 연결 안내</Button></div> : null}
        {activeTab === "recent" || activeTab === "mine" ? <section aria-label="빠른 시작" className="mb-10 grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 xl:grid-cols-4">
          {PROJECT_TYPES.map(({ id, label, description, icon: Icon, color }) => <button key={id} type="button" onClick={() => startProject(id)} disabled={id === "graphic" && !graphicReady} title={id === "graphic" && !graphicReady ? "설정에서 Codex 연결과 로그인을 완료해 주세요" : undefined} aria-haspopup="dialog" className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:items-start xl:gap-3">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${color}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span>
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
              <TabsTrigger value="recent">최근 작업</TabsTrigger>
              <TabsTrigger value="mine">내 프로젝트</TabsTrigger>
              <TabsTrigger value="examples">예제</TabsTrigger>
              <TabsTrigger value="systems">디자인 시스템</TabsTrigger>
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
                  aria-label={activeTab === "systems" ? "디자인 시스템 검색" : "프로젝트 검색"}
                  placeholder={activeTab === "systems" ? "디자인 시스템 검색" : "프로젝트 검색"}
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
              {activeTab === "systems" ? <select aria-label="디자인 시스템 상태" value={systemStatus} onChange={(event) => setSystemStatus(event.target.value as typeof systemStatus)} className="h-9 max-w-32 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="all">모든 상태</option><option value="draft">초안</option><option value="review">검토 중</option><option value="published">게시됨</option>
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
                emptyText="최근 프로젝트가 아직 없어요."
                emptyHint="프로젝트 종류를 고르고 이름을 입력하면 최근 작업한 프로젝트가 최대 12개까지 여기에 나타나요."
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
                emptyText="내 프로젝트가 아직 없어요."
                emptyHint="프로젝트 종류를 고르고 이름을 입력하면 예제를 제외한 내 프로젝트가 모두 여기에 모여요."
                onRetry={() => void mineQuery.refetch()}
                onClearQuery={clearProjectQuery}
                onStartProject={() => startProject()}
                onDelete={onProjectDelete}
              />
            </TabsContent>

            <TabsContent value="examples">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                  기본으로 들어 있는 튜토리얼, 프롬프트 샘플, 템플릿 예제예요.
                  지워도 괜찮아요 — ‘예제 복원’을 누르면 기본 세트가 다시
                  생겨요.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restoreSamplesMutation.isPending}
                  onClick={() => restoreSamplesMutation.mutate()}
                >
                  {restoreSamplesMutation.isPending
                    ? "복원하는 중..."
                    : "예제 복원"}
                </Button>
              </div>
              <ProjectCardSection
                cards={filteredExampleCards}
                sourceCount={exampleCards.length}
                query={projectQuery}
                isLoading={examplesQuery.isPending}
                error={examplesQuery.error}
                emptyText="예제 프로젝트가 아직 없어요."
                emptyHint="‘예제 복원’을 누르면 기본 예제 세트를 다시 받아올 수 있어요."
                onRetry={() => void examplesQuery.refetch()}
                onClearQuery={clearProjectQuery}
                onStartProject={() => startProject()}
                onDelete={onProjectDelete}
              />
            </TabsContent>

            <TabsContent value="systems">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div><h2 className="text-sm font-semibold">핀에서 디자인 무드 찾기</h2><p className="mt-1 text-xs text-muted-foreground">Pinterest 공개 핀의 이미지에서 색상과 무드를 모아 초안을 만들어요.</p></div>
                <Button variant="outline" onClick={() => setPinterestImportOpen(true)}>Pinterest 무드 가져오기</Button>
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
            <DialogTitle className="text-xl">새 프로젝트 만들기</DialogTitle>
            <DialogDescription className="pt-1 leading-6">형식과 작업 목적을 정하면, 프로젝트에서 AI와 함께 만들 수 있어요.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pt-5">
            <p id="project-type-label" className="mb-2 text-xs font-semibold text-muted-foreground">01 · 무엇을 만드나요?</p>
            <div role="group" aria-labelledby="project-type-label" className="flex flex-wrap gap-2">
              {[...PROJECT_TYPES, { id: "other" as const, label: "기타" }].map((type) => <button key={type.id} type="button" disabled={creatingProject || (type.id === "graphic" && !graphicReady)} aria-pressed={creationType === type.id} onClick={() => { const next = new URLSearchParams(searchParams); next.set("create", type.id); setSearchParams(next, { replace: true }); }} className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${creationType === type.id ? "border-accent bg-accent/10 text-accent" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}>{type.label}</button>)}
            </div>
            {!graphicReady && <p className="mt-2 text-xs text-muted-foreground">그래픽은 설정에서 Codex 연결과 로그인을 완료하면 사용할 수 있어요.</p>}
          </div>
          {settingsQuery.isPending ? <p role="status" className="p-6 text-sm text-muted-foreground">프로젝트 설정을 불러오는 중이에요.</p> : settingsQuery.isError ? <div role="alert" className="space-y-3 p-6"><p className="text-sm text-destructive">프로젝트 설정을 불러오지 못했어요.</p><Button variant="outline" onClick={() => void settingsQuery.refetch()}>설정 다시 불러오기</Button></div> : creationType !== null ? <NewProjectPanel generationDefaults={settingsQuery.data.generation_defaults} graphicReady={graphicReady} type={creationType} designSystems={systemsQuery.data ?? []} defaultBackend={settingsQuery.data.default_backend} systemsLoading={systemsQuery.isPending} systemsError={systemsQuery.error} onRetrySystems={() => void systemsQuery.refetch()} onPendingChange={setCreatingProject} onCreated={(project) => navigate(`/projects/${project.id}`)} /> : null}
        </DialogContent>
      </Dialog>

      <PinterestImportDialog open={pinterestImportOpen} onOpenChange={setPinterestImportOpen} onCreated={(result) => {
        void queryClient.invalidateQueries({ queryKey: ["design-systems"] });
        const unavailable = result.pins.filter((pin) => pin.status === "unavailable").length;
        pushToast({ tone: unavailable ? "warn" : "success", title: unavailable ? `무드 초안을 만들었어요. 읽지 못한 핀 ${unavailable}개는 결과에서 확인해 주세요.` : "Pinterest 무드 초안을 만들었어요." });
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
        projectName={deleteTarget?.name ?? ""}
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
  importError: string | null;
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
        프로젝트에 사용할 색상과 글꼴을 모아 두는 곳이에요. 이름과 상태로 찾거나,
        가져오기를 눌러 공개 웹사이트·저장소·PPTX/PDF에서 새 초안을 만들어 보세요.
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
                가져오기
              </div>
            </div>
          </div>
          <div className="p-4">
            <div className="text-sm font-semibold text-foreground">
              디자인 시스템 가져오기
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              Git URL, 웹사이트 URL, 또는 PPTX/PDF 업로드
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

      {!isLoading && error === null && hasFilters ? <p role="status" className="text-sm text-muted-foreground">검색 결과 {cards.length}개 <button type="button" onClick={onClearFilters} className="ml-2 font-medium text-accent underline underline-offset-2">검색과 필터 지우기</button></p> : null}

      {isLoading ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-dashed border-border bg-card/50 p-16 text-center"
        >
          <p className="text-sm font-medium text-foreground">
            디자인 시스템을 불러오는 중이에요.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            잠시만 기다려 주세요.
          </p>
        </div>
      ) : error !== null ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-10 text-center"
        >
          <p className="text-sm font-medium text-foreground">
            디자인 시스템을 불러오지 못했어요.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            로컬 서버가 켜져 있는지 확인한 뒤 다시 시도해 주세요.
          </p>
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      ) : cards.length === 0 ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 text-sm leading-6 text-muted-foreground"
        >
            {hasFilters ? "조건에 맞는 디자인 시스템이 없어요. 이름이나 상태를 바꿔 보세요." : "아직 만든 디자인 시스템이 없어요. 위 ‘가져오기’ 타일을 눌러 새로 만들어 보세요."}
        </div>
      ) : null}

      <Dialog open={importOpen} onOpenChange={(open) => { if (!open && !isPending) onToggleImport(); }}>
        <DialogContent id="system-import-panel" className="w-[calc(100%-2rem)] max-w-3xl" hideClose={isPending} onEscapeKeyDown={(event) => { if (isPending) event.preventDefault(); }} onInteractOutside={(event) => { if (isPending) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); importTriggerRef.current?.focus(); }}>
          <DialogHeader>
          <DialogTitle>
            디자인 시스템 가져오기
          </DialogTitle>
          <DialogDescription className="pt-1 leading-6">
            원본에서 색상과 글꼴을 찾아 초안을 만들어요. 가져온 뒤 미리보기를 확인하고,
            원본과 맞는지 검토한 다음 게시해 주세요.
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
              URL로 가져오기
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
              파일 업로드
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
                    원본 URL
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
                    원본 종류
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
                    <option value="auto">자동 감지</option>
                    <option value="github">Git 저장소</option>
                    <option value="website">웹사이트</option>
                    <option value="figma">Figma 파일</option>
                  </select>
                  {sourceType === "figma" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Figma 개인 액세스 토큰이 필요해요. 설정 → Figma 액세스에서
                      먼저 등록해 주세요.
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
                    업로드할 파일
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
                    지원 형식: PPTX, PDF · 최대 48 MB
                    {uploadFile
                      ? ` · 선택한 파일: ${uploadFile.name} (${formatBytes(uploadFile.size)})`
                      : ""}
                  </p>
                  {uploadTooLarge && uploadFile ? (
                    <p className="mt-1 text-xs text-destructive">
                      선택한 {uploadFile.name} 크기는{" "}
                      {formatBytes(uploadFile.size)}예요. 최대 48 MB까지 올릴 수
                      있으니 용량을 줄여 다시 내보내거나 파일을 나눠서 올려
                      주세요.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
                  문서에 사용한 글꼴과 색상, 제목·본문의 스타일을 찾아 정리해요.
                  파일 크기와 페이지 수에 따라 잠시 걸릴 수 있어요.
                </div>
              </>
            )}

            <div className="md:col-span-2">
              <label
                htmlFor="system-draft-name"
                className="text-xs font-medium text-muted-foreground"
              >
                초안 이름
              </label>
              <Input
                id="system-draft-name"
                value={draftName}
                onChange={(e) => onDraftNameChange(e.target.value)}
                placeholder="비워 두면 원본 이름을 그대로 써요"
                disabled={isPending}
                className="mt-1.5"
              />
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
              가져오기가 끝나면 디자인 시스템 화면으로 이동해요. 색상·글꼴·미리보기를
              확인하고 수정한 뒤 프로젝트에 사용할 수 있어요.
            </div>
          </div>

          {importError ? (
            <p role="alert" className="mt-3 text-xs text-destructive">{importError}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <Button variant="cta" disabled={!canImport} onClick={onImport}>
              {isPending
                ? importMode === "upload"
                  ? "올리는 중..."
                  : "가져오는 중..."
                : importMode === "upload"
                  ? "디자인 파일 올리기"
                  : "디자인 시스템 가져오기"}
            </Button>
            <Button variant="outline" disabled={isPending} onClick={onToggleImport}>
              취소
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
