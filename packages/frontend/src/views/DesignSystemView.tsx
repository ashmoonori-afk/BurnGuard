import { useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DesignSystemColorToken, DesignSystemDetail } from "@bg/shared";
import { ArrowLeft, ArrowUpRight, CheckCircle2, Pencil, Plus, Upload } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  getDesignSystemTokens,
  uploadDesignSystemFont,
  upsertDesignSystemColor,
} from "@/api/design-system";
import { catalogDetailRows, getDesignSystem, updateDesignSystemWithConflictReload } from "@/api/design-system-metadata";
import SystemPreviewGrid from "@/components/systems/SystemPreviewGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUIStore } from "@/state/uiStore";
import { ApiError, authorizedFetch } from "@/api/client";
import { apiErrorCopy } from "@/lib/error-copy";

type FontRole = "display" | "sans" | "serif" | "mono";

const STATUS_LABELS = {
  draft: "초안",
  review: "검토",
  published: "게시됨",
} as const;

const FONT_ROLE_LABELS = {
  display: "디스플레이",
  sans: "산세리프",
  serif: "세리프",
  mono: "고정폭",
} as const;

const CATALOG_DETAIL_LABELS: Record<string, string> = {
  Status: "상태",
  Template: "템플릿",
  Source: "출처",
  "Source URI": "출처 URI",
  Directory: "디렉터리",
  "Tokens CSS": "토큰 CSS",
  Archived: "보관됨",
};

export default function DesignSystemView({
  systemIdOverride,
}: {
  systemIdOverride?: string;
} = {}) {
  const { id: paramId } = useParams();
  const id = systemIdOverride ?? paramId;
  return id ? <DesignSystemEditor key={id} id={id} /> : <p role="alert">디자인 시스템을 찾을 수 없어요. <Link to="/">홈으로 이동</Link></p>;
}

function DesignSystemEditor({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const systemQuery = useQuery({
    queryKey: ["design-systems", "detail", id], queryFn: () => getDesignSystem(id),
    retry: false, refetchOnWindowFocus: false,
  });
  const system = systemQuery.data;
  const [extractionNotes, setExtractionNotes] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStatus, setDraftStatus] = useState<DesignSystemDetail["status"]>(
    "draft",
  );
  const tokensQuery = useQuery({ queryKey: ["design-systems", "tokens", id], queryFn: () => getDesignSystemTokens(id), retry: false });
  const colorTokens = tokensQuery.data?.colors ?? [];
  const tokenFilePath = tokensQuery.data?.token_file_path ?? null;
  const [editingColor, setEditingColor] = useState<DesignSystemColorToken | null>(
    null,
  );
  const [colorEditorOpen, setColorEditorOpen] = useState(false);
  const [draftColorName, setDraftColorName] = useState("");
  const [draftColorValue, setDraftColorValue] = useState("#000000");
  const [fontFile, setFontFile] = useState<File | null>(null);
  const [fontFamily, setFontFamily] = useState("");
  const [fontRole, setFontRole] = useState<FontRole>("sans");
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const colorEditorRef = useRef<HTMLDivElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);

  const updateMutation = useMutation({
    mutationFn: async (nextStatus?: DesignSystemDetail["status"]) => {
      if (!id) throw new Error("missing id");
      if (!system) throw new Error("missing system");
      const trimmedName = nextStatus ? system.name : draftName.trim();
      if (!trimmedName) throw new Error("이름을 비워 둘 수 없어요.");
      return await updateDesignSystemWithConflictReload(id, {
        expected_revision: system.metadata_revision,
        name: trimmedName,
        description: nextStatus ? system.description : draftDescription.trim() ? draftDescription.trim() : null,
        status: nextStatus ?? draftStatus,
        tags: system.tags,
      });
    },
    onSuccess: async (result) => {
      if (result.kind === "conflict") {
        queryClient.setQueryData(["design-systems", "detail", id], result.current);
        setDraftName(result.current.name);
        setDraftDescription(result.current.description ?? "");
        setDraftStatus(result.current.status);
        pushToast({
          title: "다른 곳에서 디자인 시스템이 변경됐어요",
          body: "현재 메타데이터를 다시 불러왔어요. 검토한 뒤 다시 저장해 주세요.",
          tone: "error",
        });
        return;
      }
      queryClient.setQueryData(["design-systems", "detail", id], result.system);
      setEditing(false);
      pushToast({ title: "디자인 시스템을 업데이트했어요", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["design-systems"] });
    },
    onError: (err) => {
      pushToast({
        title: "디자인 시스템을 업데이트하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const colorMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("missing id");
      return await upsertDesignSystemColor(id, {
        name: draftColorName.trim(),
        value: draftColorValue.trim(),
      });
    },
    onSuccess: (tokens) => {
      queryClient.setQueryData(["design-systems", "tokens", id], tokens);
      setEditingColor(null);
      setColorEditorOpen(false);
      setDraftColorName("");
      setDraftColorValue("#000000");
      setPreviewRefreshKey((key) => key + 1);
      pushToast({ title: "색상 토큰을 저장했어요", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "색상을 저장하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  const fontMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("missing id");
      if (!fontFile) throw new Error("먼저 글꼴 파일을 선택해 주세요.");
      return await uploadDesignSystemFont(id, fontFile, {
        family: fontFamily,
        role: fontRole,
      });
    },
    onSuccess: (font) => {
      setFontFile(null);
      setFontFamily("");
      if (fontInputRef.current) {
        fontInputRef.current.value = "";
      }
      setPreviewRefreshKey((key) => key + 1);
      pushToast({
        title: "글꼴을 업로드했어요",
        body: `${font.family} 글꼴을 디자인 시스템에서 사용할 수 있어요.`,
        tone: "success",
      });
    },
    onError: (err) => {
      pushToast({
        title: "글꼴을 업로드하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  useEffect(() => {
    const controller = new AbortController();

    // Best-effort fetch of the extraction report written by P4.1 / P4.2
    // ingestion. Non-extracted systems (seeded samples) return 404, which
    // we treat as "no notes" without surfacing an error.
    void authorizedFetch(`/api/design-systems/${encodeURIComponent(id)}/files/uploads/extraction-report.json`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { notes?: unknown };
      })
      .then((payload) => {
        if (controller.signal.aborted || !payload) return;
        const notes = Array.isArray(payload.notes)
          ? payload.notes.filter((n): n is string => typeof n === "string")
          : [];
        setExtractionNotes(notes);
      })
      .catch(() => {
        // ignore — notes are advisory
      });

    return () => controller.abort();
  }, [id]);

  if (systemQuery.isError) {
    return <div role="alert" className="mx-auto my-12 max-w-lg space-y-4 px-6 text-center">
      <h1 className="text-lg font-semibold">{systemQuery.error instanceof ApiError && systemQuery.error.status === 404 ? "디자인 시스템을 찾을 수 없어요" : "디자인 시스템을 불러오지 못했어요"}</h1>
      <p className="text-sm text-muted-foreground">{systemQuery.error instanceof ApiError && systemQuery.error.status === 404 ? "삭제되었거나 주소가 달라졌을 수 있어요. 홈에서 다시 선택해 주세요." : apiErrorCopy(systemQuery.error)}</p>
      <div className="flex justify-center gap-3">
        <Button variant="outline" onClick={() => void systemQuery.refetch()} disabled={systemQuery.isFetching}>{systemQuery.isFetching ? "불러오는 중…" : "다시 시도"}</Button>
        <Button asChild variant="ghost"><Link to="/">홈으로 이동</Link></Button>
      </div>
    </div>;
  }

  if (!system) {
    return (
      <div className="grid flex-1 place-items-center">
        <div role="status" className="text-sm text-muted-foreground">
          디자인 시스템을 불러오는 중...
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <Link to="/?view=systems" className="mb-5 inline-flex min-h-9 items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-4 w-4" />디자인 라이브러리로 돌아가기</Link>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">디자인 시스템</span><Badge variant={system.status === "published" ? "accent" : "outline"}>{STATUS_LABELS[system.status]}</Badge>{system.is_template ? <Badge variant="outline">템플릿</Badge> : null}</div>
            {!editing ? (
              <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={updateMutation.isPending}
                onClick={() => {
                  setDraftName(system.name);
                  setDraftDescription(system.description ?? "");
                  setDraftStatus(system.status);
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                세부 정보 편집
              </Button>
              {system.status !== "published" ? <Button variant="cta" size="sm" onClick={() => updateMutation.mutate(system.status === "draft" ? "review" : "published")} disabled={updateMutation.isPending}>{updateMutation.isPending ? "저장하는 중…" : system.status === "draft" ? "검토 시작" : "디자인 시스템 게시"}<ArrowUpRight className="h-3.5 w-3.5" /></Button> : null}
              </div>
            ) : null}
          </div>

          {!editing ? (
            <>
              <h1 className="mt-5 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
                {system.name}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                {system.description ??
                  "색상과 글꼴을 확인하고 프로젝트에 사용할 디자인을 정리해 보세요."}
              </p>
            </>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  이름
                </label>
                <Input
                  id="ds-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  disabled={updateMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-description"
                  className="text-xs font-medium text-muted-foreground"
                >
                  설명
                </label>
                <textarea
                  id="ds-description"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={3}
                  disabled={updateMutation.isPending}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-status"
                  className="text-xs font-medium text-muted-foreground"
                >
                  상태
                </label>
                <select
                  id="ds-status"
                  value={draftStatus}
                  onChange={(e) =>
                    setDraftStatus(
                      e.target.value as DesignSystemDetail["status"],
                    )
                  }
                  disabled={updateMutation.isPending}
                  className="flex h-9 w-full max-w-[200px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
                >
                  <option value="draft">{STATUS_LABELS.draft}</option>
                  <option value="review">{STATUS_LABELS.review}</option>
                  <option value="published">{STATUS_LABELS.published}</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="cta"
                  onClick={() => updateMutation.mutate(undefined)}
                  disabled={
                    updateMutation.isPending || !draftName.trim()
                  }
                >
                  {updateMutation.isPending ? "저장하는 중…" : "변경 사항 저장"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={updateMutation.isPending}
                >
                  취소
                </Button>
              </div>
            </div>
          )}

          {system.status === "draft" ? (
            <DraftValidationCard system={system} notes={extractionNotes} />
          ) : null}

          <nav aria-label="디자인 시스템 섹션" className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
            {[{ id: "system-previews", label: "디자인 미리보기" }, { id: "system-style-editor", label: "색상과 글꼴" }, { id: "system-source-details", label: "원본 정보" }].map(({ id: sectionId, label }) => <Button key={sectionId} size="sm" variant="outline" onClick={() => { const section = document.getElementById(sectionId); if (section instanceof HTMLDetailsElement) section.open = true; section?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{label}</Button>)}
          </nav>
        </div>
        <section id="system-previews" className="mt-6 scroll-mt-6 rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-5 sm:px-7"><h2 className="text-lg font-semibold">디자인 미리보기</h2><p className="mt-1 text-sm text-muted-foreground">저장된 디자인 자료를 확인하고 프로젝트에 사용할 스타일을 다듬어요.</p></div>
          <SystemPreviewGrid systemId={id} onEditColors={() => colorEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} previewRefreshKey={previewRefreshKey} />
        </section>
        <section id="system-style-editor" className="mt-8 scroll-mt-6">
          <div className="mb-4"><h2 className="text-lg font-semibold">색상과 글꼴 편집</h2><p className="mt-1 text-sm text-muted-foreground">색상 저장과 글꼴 업로드는 각각 바로 적용돼요.</p></div>
          {tokensQuery.isError ? <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"><p className="text-sm">색상을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.</p><Button variant="outline" size="sm" disabled={tokensQuery.isFetching} onClick={() => void tokensQuery.refetch()}>다시 시도</Button></div> : null}
          <div className="grid min-w-0 gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <FontUploadCard
              file={fontFile}
              family={fontFamily}
              role={fontRole}
              saving={fontMutation.isPending}
              inputRef={fontInputRef}
              onFileChange={setFontFile}
              onFamilyChange={setFontFamily}
              onRoleChange={setFontRole}
              onUpload={() => fontMutation.mutate()}
            />
            {tokensQuery.isPending || tokensQuery.isError ? <section role="status" className="grid min-h-48 place-items-center rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">{tokensQuery.isPending ? "색상을 불러오는 중이에요." : "색상을 다시 불러오면 편집할 수 있어요."}</section> : <ColorTokenEditor
              refEl={colorEditorRef}
              tokens={colorTokens}
              tokenFilePath={tokenFilePath}
              editingToken={editingColor}
              open={colorEditorOpen}
              name={draftColorName}
              value={draftColorValue}
              saving={colorMutation.isPending}
              onAdd={() => {
                setColorEditorOpen(true);
                setEditingColor(null);
                setDraftColorName("new-color");
                setDraftColorValue("#000000");
                colorEditorRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
              onEdit={(token) => {
                setColorEditorOpen(true);
                setEditingColor(token);
                setDraftColorName(token.name);
                setDraftColorValue(token.value);
                colorEditorRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
              onNameChange={setDraftColorName}
              onValueChange={setDraftColorValue}
              onSave={() => colorMutation.mutate()}
              onCancel={() => {
                setColorEditorOpen(false);
                setEditingColor(null);
                setDraftColorName("");
                setDraftColorValue("#000000");
              }}
            />}
          </div>
        </section>
          <details id="system-source-details" className="mt-6 scroll-mt-6 rounded-2xl border border-border bg-card p-5">
            <summary className="cursor-pointer text-sm font-medium">원본과 파일 정보</summary>
            <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
              {catalogDetailRows(system).map((row) => <InfoRow key={row.label} label={CATALOG_DETAIL_LABELS[row.label] ?? row.label} value={row.label === "Status" ? STATUS_LABELS[system.status] : row.label === "Template" ? system.is_template ? "예" : "아니요" : row.value} />)}
            </dl>
          </details>

      </div>
    </div>
  );
}

function FontUploadCard({
  file,
  family,
  role,
  saving,
  inputRef,
  onFileChange,
  onFamilyChange,
  onRoleChange,
  onUpload,
}: {
  file: File | null;
  family: string;
  role: FontRole;
  saving: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onFileChange: (file: File | null) => void;
  onFamilyChange: (value: string) => void;
  onRoleChange: (value: FontRole) => void;
  onUpload: () => void;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            글꼴
          </div>
          <h2 className="mt-1 text-base font-semibold">글꼴 업로드</h2>
        </div>
        <Upload className="mt-1 h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="system-font-file" className="text-xs font-medium text-muted-foreground">
            글꼴 파일
          </label>
          <Input
            id="system-font-file"
            ref={inputRef}
            type="file"
            accept=".woff2,.woff,.ttf,.otf"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            disabled={saving}
          />
          {file ? (
            <div className="font-mono text-[11px] text-muted-foreground">
              {file.name}
            </div>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="system-font-family" className="text-xs font-medium text-muted-foreground">
            글꼴 패밀리
          </label>
          <Input
            id="system-font-family"
            value={family}
            placeholder="비워 두면 파일 이름에서 추정해요"
            onChange={(e) => onFamilyChange(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="system-font-role" className="text-xs font-medium text-muted-foreground">
            토큰에 할당
          </label>
          <select
            id="system-font-role"
            value={role}
            onChange={(e) => onRoleChange(e.target.value as FontRole)}
            disabled={saving}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          >
            <option value="sans">{FONT_ROLE_LABELS.sans}</option>
            <option value="display">{FONT_ROLE_LABELS.display}</option>
            <option value="serif">{FONT_ROLE_LABELS.serif}</option>
            <option value="mono">{FONT_ROLE_LABELS.mono}</option>
          </select>
        </div>
        <Button
          variant="cta"
          className="w-full"
          onClick={onUpload}
          disabled={saving || !file}
        >
          {saving ? "업로드하는 중..." : "글꼴 업로드"}
        </Button>
      </div>
    </section>
  );
}

export function ColorTokenEditor({
  refEl,
  tokens,
  tokenFilePath,
  editingToken,
  open,
  name,
  value,
  saving,
  onAdd,
  onEdit,
  onNameChange,
  onValueChange,
  onSave,
  onCancel,
}: {
  refEl: RefObject<HTMLDivElement>;
  tokens: DesignSystemColorToken[];
  tokenFilePath: string | null;
  editingToken: DesignSystemColorToken | null;
  open: boolean;
  name: string;
  value: string;
  saving: boolean;
  onAdd: () => void;
  onEdit: (token: DesignSystemColorToken) => void;
  onNameChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <section ref={refEl} className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            색상
          </div>
          <h2 className="mt-1 text-base font-semibold">색상 토큰</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {tokenFilePath ? "프로젝트에 사용할 색상을 추가하거나 바꿀 수 있어요." : "저장된 색상 자료가 없어요. 새 색상부터 추가해 보세요."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd} disabled={saving} aria-expanded={open} aria-controls="system-color-editor">
          <Plus className="h-3.5 w-3.5" />
          색상 추가
        </Button>
      </div>

      {open ? (
        <div id="system-color-editor" className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 text-xs font-medium">
            {editingToken ? `--${editingToken.name} 편집` : "색상 토큰 추가"}
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr]">
            <div className="space-y-1.5">
              <label htmlFor="system-color-name" className="text-xs font-medium text-muted-foreground">
                토큰 이름
              </label>
              <Input
                id="system-color-name"
                aria-invalid={!name.trim()}
                aria-describedby={!name.trim() ? "system-color-name-error" : undefined}
                value={name}
                placeholder="primary-blue"
                onChange={(e) => onNameChange(e.target.value)}
                disabled={saving || Boolean(editingToken)}
              />
              {!name.trim() ? <p id="system-color-name-error" className="text-xs text-destructive">저장하려면 색상 이름을 입력해 주세요.</p> : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="system-color-value" className="text-xs font-medium text-muted-foreground">
                색상 값
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  aria-label="색상 선택"
                  value={normalizeColorInput(value)}
                  onChange={(e) => onValueChange(e.target.value)}
                  disabled={saving}
                  className="h-9 w-11 shrink-0 rounded-md border border-input bg-background p-1"
                />
                <Input
                  id="system-color-value"
                  value={value}
                  placeholder="#0057B8"
                  onChange={(e) => onValueChange(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="cta"
              size="sm"
              onClick={onSave}
              disabled={saving || !name.trim() || !value.trim()}
            >
              {saving ? "저장하는 중..." : "색상 저장"}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              취소
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {tokens.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            아직 감지된 색상 토큰이 없어요.
          </div>
        ) : (
          tokens.map((token) => (
            <div
              key={token.name}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"
            >
              <div
                className="h-8 w-8 shrink-0 rounded-md border border-border"
                style={{ background: token.value }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">--{token.name}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {token.value}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs"
                onClick={() => onEdit(token)}
                disabled={saving}
                aria-label={`${token.name} 색상 편집`}
              >
                <Pencil className="h-3 w-3" />
                편집
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function normalizeColorInput(value: string): string {
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : "#000000";
}

function DraftValidationCard({
  system,
  notes,
}: {
  system: DesignSystemDetail;
  notes: string[];
}) {
  return (
    <section className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" /><div className="min-w-0"><h2 className="text-sm font-semibold">미리보기를 확인한 뒤 검토를 시작해요</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{system.name}의 색상, 글꼴, 컴포넌트가 원본과 맞는지 확인해 주세요. 필요한 부분을 수정한 뒤 검토 상태로 변경할 수 있어요.</p></div></div>
      {notes.length > 0 ? <details className="mt-3 border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">추출 메모 {notes.length}개</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details> : null}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 break-all font-mono text-xs text-foreground">
        {value}
      </dd>
    </div>
  );
}
