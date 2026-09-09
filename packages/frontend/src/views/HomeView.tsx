import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  deleteDesignSystem,
  extractDesignSystem,
  uploadDesignSystem,
} from "@/api/design-system";
import { ApiError } from "@/api/client";
import {
  deleteProject,
  detectBackends,
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
import DeleteDesignSystemDialog from "@/components/home/DeleteDesignSystemDialog";
import DeleteProjectDialog from "@/components/home/DeleteProjectDialog";
import CliMissingModal from "@/components/errors/CliMissingModal";
import { apiErrorCopy } from "@/lib/error-copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useUIStore } from "@/state/uiStore";

type HomeTab = "recent" | "mine" | "examples" | "systems";
type SystemImportMode = "url" | "upload";

export default function HomeView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [activeTab, setActiveTab] = useState<HomeTab>("recent");
  const [projectQuery, setProjectQuery] = useState("");
  const [systemQuery, setSystemQuery] = useState("");
  const [systemStatus, setSystemStatus] = useState<"all" | "draft" | "review" | "published">("all");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cliMissingShown = useUIStore((s) => s.cliMissingShown);
  const setCliMissingShown = useUIStore((s) => s.setCliMissingShown);
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
    enabled: activeTab === "systems",
  });
  const detectionQuery = useQuery({
    queryKey: ["backends", "detect"],
    queryFn: detectBackends,
  });

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

  useEffect(() => {
    const detection = detectionQuery.data;
    if (!detection || cliMissingShown) {
      return;
    }

    if (detection.backends.every((backend) => !backend.found)) {
      setCliMissingOpen(true);
      setCliMissingShown(true);
    }
  }, [cliMissingShown, detectionQuery.data, setCliMissingShown]);

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

  // The creation form lives in the app shell's sidebar, outside this
  // view's tree, so the empty state hands off by focusing its name
  // field by id. Plain focus() also scrolls the control into view,
  // which is what the narrow layout needs since the sidebar is ordered
  // below the grid there.
  const startProject = () => {
    document.getElementById("new-project-panel")?.scrollIntoView({ block: "start" });
    document.getElementById("project-name")?.focus();
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-3 sm:px-8">
          <h1 className="text-lg font-semibold">내 작업</h1>
          <Button variant="cta" onClick={startProject} aria-controls="new-project-panel"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />새 프로젝트</Button>
        </div>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as HomeTab)}
          className="flex flex-1 flex-col"
        >
          <div className="flex items-center justify-between gap-4 px-8 pb-4 pt-8 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:px-4 max-[640px]:pt-4">
            <TabsList className="max-[640px]:grid max-[640px]:h-auto max-[640px]:w-full max-[640px]:grid-cols-2">
              <TabsTrigger value="recent">최근</TabsTrigger>
              <TabsTrigger value="mine">내 디자인</TabsTrigger>
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

          <div className="px-8 pb-8 max-[640px]:px-4">
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
                onStartProject={startProject}
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
                onStartProject={startProject}
                onDelete={onProjectDelete}
              />
            </TabsContent>

            <TabsContent value="examples">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
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
                onStartProject={startProject}
                onDelete={onProjectDelete}
              />
            </TabsContent>

            <TabsContent value="systems">
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
          type="button"
          onClick={onToggleImport}
          aria-expanded={importOpen}
          aria-controls="system-import-panel"
          className="overflow-hidden rounded-xl border border-dashed border-border bg-card text-left transition-colors hover:border-foreground/40 hover:shadow-app-3"
        >
          <div className="grid h-[120px] place-items-center bg-accent/10 text-accent">
            <div className="grid place-items-center gap-2">
              <div className="grid h-12 w-12 place-items-center rounded-full border border-current/20 bg-white/70">
                <Plus className="h-6 w-6" />
              </div>
              <div className="text-xs font-medium tracking-[0.16em]">
                가져오기
              </div>
            </div>
          </div>
          <div className="p-3">
            <div className="text-sm font-medium text-foreground">
              디자인 시스템 가져오기
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
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

      {importOpen ? (
        <div id="system-import-panel" className="rounded-xl border border-border bg-card p-5">
          <div className="text-sm font-medium text-foreground">
            디자인 시스템 가져오기
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            원본에서 색상과 글꼴을 찾아 초안을 만들어요. 가져온 뒤 미리보기를 확인하고,
            원본과 맞는지 검토한 다음 게시해 주세요.
          </p>

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
        </div>
      ) : null}
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
