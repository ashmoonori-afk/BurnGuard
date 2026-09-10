import { loadComposerDraft } from "@/components/chat/useComposerDraft";
import type { ReadyAttachmentSource } from "@/components/chat/attachment-intake";
import { saveAndRequestCommentEdit } from "@/components/modes/comment-edit-request";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
const ThreeScenePanel = lazy(() => import("@/components/canvas/ThreeScenePanel"));
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ArtifactSummary,
  GenerationOptions,
  Comment,
  DesignAuditFinding,
  DesignAuditResult,
  DesignDirectionState,
  FileInfo,
  NormalizedEvent,
  PatchFileRequest,
  ProjectDetail,
} from "@bg/shared";
import { parseDesignDirectionState } from "@bg/shared";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MessageSquare, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getArtifacts,
  getProject,
  getProjectSession,
  listProjectFiles,
  refreshArtifacts,
} from "@/api/project";
import { ApiError } from "@/api/client";
import { isStaleIdentityError, readFileIdentity } from "@/lib/artifact-identity";
import { getProjectDesignAudit, retryProjectDesignAudit } from "@/api/design-audit";
import { restoreCheckpoint } from "@/api/checkpoints";
import { getFileUndoInfo, patchProjectFile, undoLastFilePatch } from "@/api/files";
import {
  createProjectComment,
  listProjectComments,
  updateProjectComment,
} from "@/api/comments";
import {
  cancelDesignDirections,
  generateDesignDirections,
  getDesignDirectionState,
  retryDesignDirections,
  selectDesignDirection,
  undoDesignDirectionSelection,
} from "@/api/design-directions";
import {
  interruptSession,
  sendUserEvent,
  submitToolDecision,
} from "@/api/session";
import ChatPane from "@/components/chat/ChatPane";
import { visualSourceSendErrorCopy } from "@/components/chat/attachment-intake";
import { DirectionsView } from "@/components/directions/DirectionsView";
import { DirectionStatusBar } from "@/components/directions/DirectionStatusBar";
import PermissionDialog from "@/components/chat/PermissionDialog";
import { useSessionEvents } from "@/hooks/useSessionEvents";
import { apiErrorCopy } from "@/lib/error-copy";
import Canvas from "@/components/canvas/Canvas";
import ColorPalette from "@/components/canvas/ColorPalette";
import { qualityFixRequest } from "@/lib/quality-fix-request";
import {
  deserializeDraws,
  serializeDraws,
  type DrawLayerHandle,
  type DrawShape,
  type DrawTool,
} from "@/components/canvas/DrawLayer";
import type { EditTarget } from "@/components/canvas/EditLayer";
import type {
  TweaksStyleKey,
  TweaksTarget,
} from "@/components/canvas/TweaksLayer";
import { getProjectDraws, putProjectDraws } from "@/api/draws";
import PresentOverlay from "@/components/present/PresentOverlay";
import ModePanel from "@/components/modes/ModePanel";
import { DESIGN_AUDIT_ERROR_COPY } from "@/components/modes/design-audit-copy";
import {
  buildTweakChangePreview,
  type TweakChangePreview,
} from "@/components/modes/TweaksPanel";
import type { CanvasMode } from "@/components/modes/types";
import ArtifactTabs from "@/components/project/ArtifactTabs";
import ProjectTopBar from "@/components/project/ProjectTopBar";
import DesignFilesView from "@/views/DesignFilesView";
import DesignSystemView from "@/views/DesignSystemView";
import { useUIStore } from "@/state/uiStore";
import type { ArtifactTab } from "@/types/project";
import {
  latestDirectionState,
  preferDirectionState,
} from "@/lib/design-direction-state";
import { parseProjectGraphicCanvas } from "@/lib/graphic-project";
import {
  designAuditErrorCode,
  designAuditViewState,
  groupDesignAuditResult,
  isDesignAuditCurrent,
  preferDesignAuditResult,
} from "@/lib/design-audit-state";
import { isSafeCanvasPagePath, resolveCanvasNavigation, resolveCanvasPageTarget, resolveCanvasSource } from "@/lib/canvas-source";

export default function ProjectView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);

  // Pre-fill from a "Try this prompt" handoff (P4.7e). The home route
  // base64url-encodes the prompt into ?prefill_prompt; we decode it
  // once on mount, hand it to the composer, and strip the param so a
  // refresh doesn't re-prefill on top of whatever the user has typed.
  const [composerPrefill, setComposerPrefill] = useState<string>(() => {
    const raw = searchParams.get("prefill_prompt");
    if (!raw) return "";
    try {
      // base64url → base64 (atob doesn't accept the URL-safe variant)
      // and then decode UTF-8 bytes into a JS string. The padding fix
      // covers prompts whose encoded length is not a multiple of 4.
      const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (searchParams.has("prefill_prompt")) {
      const next = new URLSearchParams(searchParams);
      next.delete("prefill_prompt");
      setSearchParams(next, { replace: true });
    }
    // Run only on first mount; subsequent param edits should not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTabId, setActiveTabId] = useState("design-system");
  const [mobilePane, setMobilePane] = useState<"workspace" | "chat">("workspace");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [openFileTabs, setOpenFileTabs] = useState<ArtifactTab[]>([]);
  const [canvasNavigation, setCanvasNavigation] = useState<{ projectId: string; relPath: string; url: string } | null>(null);
  const [mode, setMode] = useState<CanvasMode | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [activeSlideIdx, setActiveSlideIdx] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [tweaksTarget, setTweaksTarget] = useState<TweaksTarget | null>(null);
  const [tweakReview, setTweakReview] = useState<TweakChangePreview | null>(
    null,
  );
  const [auditFocus, setAuditFocus] = useState<{ readonly findingId: string; readonly nodeBgId: string; readonly relPath: string } | null>(null);
  const [auditRevealResult, setAuditRevealResult] = useState<"found" | "not_found" | null>(null);
  const [auditActionError, setAuditActionError] = useState<Error | null>(null);
  const tweaksUndoRef = useRef<TweaksUndoFrame[]>([]);
  const tweaksRedoRef = useRef<TweaksUndoFrame[]>([]);
  const [presentOpen, setPresentOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool>("pen");
  const [drawColor, setDrawColor] = useState("#EF4444");
  const [drawStrokeWidth, setDrawStrokeWidth] = useState(4);
  const [drawShapes, setDrawShapes] = useState<DrawShape[]>([]);
  const [drawResetKey, setDrawResetKey] = useState("");
  const [drawLoading, setDrawLoading] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const drawBlocked = drawLoading || drawError !== null;
  const [drawLoadAttempt, setDrawLoadAttempt] = useState(0);
  const drawSavesRef = useRef(new Map<string, Promise<unknown>>());
  const drawLayerRef = useRef<DrawLayerHandle | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sendPending, setSendPending] = useState(false);
  const [autoFixPending, setAutoFixPending] = useState(false);
  const autoFixRef = useRef(false);
  const [chatFocusKey, setChatFocusKey] = useState(0);
  useEffect(() => { if (chatFocusKey > 0) setChatCollapsed(false); }, [chatFocusKey]);
  const [directionActionError, setDirectionActionError] = useState<Error | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  const openFileTabsRef = useRef<ArtifactTab[]>(openFileTabs);
  const sendPendingTimeoutRef = useRef<number | null>(null);
  const turnTouchedFilesRef = useRef(false);

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  });
  const sessionQuery = useQuery({
    queryKey: ["project", id, "session"],
    queryFn: () => getProjectSession(id!),
    enabled: Boolean(id),
  });
  const filesQuery = useQuery({
    queryKey: ["project", id, "files"],
    queryFn: () => listProjectFiles(id!),
    enabled: Boolean(id),
  });
  const artifactsQuery = useQuery({
    queryKey: ["project", id, "artifacts"],
    queryFn: () => getArtifacts(id!),
    enabled: Boolean(id),
  });
  const designAuditQueryKey = useMemo(() => ["project", id, "design-audit"] as const, [id]);
  const designAuditQuery = useQuery({
    queryKey: designAuditQueryKey,
    queryFn: async () => {
      const incoming = await getProjectDesignAudit(id ?? "");
      const current = queryClient.getQueryData<DesignAuditResult | null>(designAuditQueryKey) ?? null;
      return preferDesignAuditResult(current, incoming, id ?? "");
    },
    enabled: Boolean(id && artifactsQuery.data?.entrypoint_url),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const invalidateDesignAudit = useCallback(() => queryClient.invalidateQueries({ queryKey: designAuditQueryKey }), [designAuditQueryKey, queryClient]);
  // Every artifact write carries the revision/digest the user was looking at.
  // A stale rejection means someone else moved the canvas: refetch identity
  // and ask for one retry instead of showing the raw backend message.
  const handleWriteError = useCallback((title: string, error: unknown) => {
    if (isStaleIdentityError(error)) {
      void queryClient.invalidateQueries({ queryKey: ["project", id, "artifacts"] });
      pushToast({ title: "캔버스가 바뀌어서 다시 불러왔어요. 한 번 더 시도해 주세요", tone: "error" });
      return;
    }
    pushToast({ title, body: apiErrorCopy(error), tone: "error" });
  }, [id, pushToast, queryClient]);
  const commentsQuery = useQuery({
    queryKey: ["project", id, "comments"],
    queryFn: () => listProjectComments(id!),
    enabled: Boolean(id),
  });
  const directionQueryKey = useMemo(
    () => ["project", id, "design-directions"] as const,
    [id],
  );
  const directionQuery = useQuery({
    queryKey: directionQueryKey,
    queryFn: async () => {
      const incoming = await getDesignDirectionState(id ?? "");
      const current =
        queryClient.getQueryData<DesignDirectionState | null>(directionQueryKey) ?? null;
      return preferDirectionState(current, incoming);
    },
    enabled: Boolean(id),
  });
  const mergeDirectionCache = useCallback(
    (incoming: DesignDirectionState | null) => {
      queryClient.setQueryData<DesignDirectionState | null>(
        directionQueryKey,
        (current) => preferDirectionState(current ?? null, incoming),
      );
    },
    [directionQueryKey, queryClient],
  );

  const generateDirectionsMutation = useMutation({
    mutationFn: () => generateDesignDirections(id ?? ""),
    onMutate: () => setDirectionActionError(null),
    onSuccess: mergeDirectionCache,
    onError: setDirectionActionError,
  });
  const cancelDirectionsMutation = useMutation({
    mutationFn: () => cancelDesignDirections(id ?? ""),
    onMutate: () => setDirectionActionError(null),
    onSuccess: mergeDirectionCache,
    onError: setDirectionActionError,
  });
  const retryDirectionsMutation = useMutation({
    mutationFn: () => retryDesignDirections(id ?? ""),
    onMutate: () => setDirectionActionError(null),
    onSuccess: mergeDirectionCache,
    onError: setDirectionActionError,
  });
  const selectDirectionMutation = useMutation({
    mutationFn: (input: {
      readonly generationId: string;
      readonly revision: number;
      readonly directionId: string;
    }) =>
      selectDesignDirection(id ?? "", {
        generation_id: input.generationId,
        expected_selection_revision: input.revision,
        direction_id: input.directionId,
      }),
    onMutate: () => setDirectionActionError(null),
    onSuccess: mergeDirectionCache,
    onError: setDirectionActionError,
  });
  const undoDirectionMutation = useMutation({
    mutationFn: (input: { readonly generationId: string; readonly revision: number }) =>
      undoDesignDirectionSelection(id ?? "", {
        generation_id: input.generationId,
        expected_selection_revision: input.revision,
      }),
    onMutate: () => setDirectionActionError(null),
    onSuccess: mergeDirectionCache,
    onError: setDirectionActionError,
  });

  const mergeDesignAuditCache = useCallback((incoming: DesignAuditResult) => {
    queryClient.setQueryData<DesignAuditResult | null>(designAuditQueryKey, (current) => preferDesignAuditResult(current ?? null, incoming, id ?? ""));
  }, [designAuditQueryKey, id, queryClient]);
  const retryDesignAuditMutation = useMutation({
    mutationFn: () => retryProjectDesignAudit(id ?? ""),
    onMutate: () => setAuditActionError(null),
    onSuccess: mergeDesignAuditCache,
    onError: (error) => setAuditActionError(error instanceof Error ? error : new Error(String(error))),
  });
  const safeFixMutation = useMutation({
    mutationFn: (input: { readonly findingId: string; readonly relPath: string; readonly request: PatchFileRequest }) =>
      patchProjectFile(id ?? "", input.relPath, input.request),
    onSuccess: async (_response, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", id] }),
        queryClient.invalidateQueries({ queryKey: ["project", id, "files"] }),
        queryClient.invalidateQueries({ queryKey: ["project", id, "artifacts"] }),
        queryClient.invalidateQueries({ queryKey: ["project", id, "fs", input.relPath, "undo-info"] }),
        invalidateDesignAudit(),
      ]);
      setRefreshTick((value) => value + 1);
      pushToast({ title: "안전 수정을 적용했어요", tone: "success" });
    },
    onError: (error) => {
      pushToast({ title: "안전 수정을 적용하지 못했어요", body: DESIGN_AUDIT_ERROR_COPY[designAuditErrorCode(error)], tone: "error" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshArtifacts(id!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", id, "files"] }),
        queryClient.invalidateQueries({
          queryKey: ["project", id, "artifacts"],
        }),
        invalidateDesignAudit(),
      ]);
      setRefreshTick((value) => value + 1);
    },
    onError: (error) => {
      pushToast({
        title: "캔버스를 새로 고치지 못했어요",
        body: apiErrorCopy(error),
        tone: "error",
      });
    },
  });

  const createCommentMutation = useMutation({
    mutationFn: (input: {
      rel_path: string;
      x_pct: number;
      y_pct: number;
      node_selector: string;
      slide_index: number | null;
    }) => {
      const artifact = requireLoadedArtifacts(artifactsQuery.data);
      return createProjectComment(id!, {
        ...input,
        artifact_revision: artifact.current_revision,
        artifact_digest: artifact.current_digest,
      });
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Comment[]>(
        ["project", id, "comments"],
        (prev) => (prev ? [...prev, created] : [created]),
      );
      setFocusedCommentId(created.id);
    },
    onError: (error) => handleWriteError("코멘트를 만들지 못했어요", error),
  });

  const updateCommentMutation = useMutation({
    mutationFn: ({
      commentId,
      patch,
    }: {
      commentId: string;
      patch: { body?: string; resolved?: boolean };
    }) => updateProjectComment(id!, commentId, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Comment[]>(
        ["project", id, "comments"],
        (prev) =>
          prev
            ? prev.map((c) => (c.id === updated.id ? updated : c))
            : [updated],
      );
    },
    onError: (error) => {
      pushToast({
        title: "코멘트를 수정하지 못했어요",
        body: apiErrorCopy(error),
        tone: "error",
      });
    },
  });

  const toolDecisionMutation = useMutation({
    mutationFn: (input: {
      toolCallId: string;
      decision: "allow" | "deny";
    }) => {
      if (!sessionQuery.data) throw new Error("no_session");
      return submitToolDecision(sessionQuery.data.id, input);
    },
    onSuccess: () => { void stream.refreshSnapshot().catch(() => {}); },
    onError: (error) => {
      void stream.refreshSnapshot().catch(() => {});
      pushToast({
        title: "권한 결정을 보내지 못했어요",
        body: apiErrorCopy(error),
        tone: "error",
      });
    },
  });

  const tweaksMutation = useMutation({
    mutationFn: async ({
      relPath,
      patch,
    }: {
      relPath: string;
      patch: PatchFileRequest;
      history?: TweaksHistoryIntent;
    }) =>
      patchProjectFile(id!, relPath, {
        ...(await readFileIdentity(id!, relPath, patch.node_bg_id)),
        ...patch,
      }),
    onSuccess: (_data, variables) => {
      applyTweaksHistory(variables.history, tweaksUndoRef, tweaksRedoRef);
      const bgId = variables.patch.node_bg_id;
      setTweaksTarget((current) =>
        current && current.bg_id === bgId && variables.patch.styles
          ? mergeTweaksTargetInline(current, variables.patch.styles)
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["project", id, "files"] });
      void queryClient.invalidateQueries({ queryKey: ["project", id, "artifacts"] });
      void queryClient.invalidateQueries({
        queryKey: ["project", id, "fs", variables.relPath, "undo-info"],
      });
      void invalidateDesignAudit();
      setRefreshTick((value) => value + 1);
    },
    onError: (error) => handleWriteError("스타일을 적용하지 못했어요", error),
  });

  const patchFileMutation = useMutation({
    mutationFn: async ({
      relPath,
      patch,
    }: {
      relPath: string;
      patch: PatchFileRequest;
    }) =>
      patchProjectFile(id!, relPath, {
        ...(await readFileIdentity(id!, relPath, patch.node_bg_id)),
        ...patch,
      }),
    onSuccess: async (_updated, variables) => {
      setEditTarget((current) =>
        current && current.bg_id === variables.patch.node_bg_id
          ? applyEditPatch(current, variables.patch)
          : current,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", id, "files"] }),
        queryClient.invalidateQueries({ queryKey: ["project", id, "artifacts"] }),
        queryClient.invalidateQueries({
          queryKey: ["project", id, "fs", variables.relPath, "undo-info"],
        }),
        invalidateDesignAudit(),
      ]);
      setRefreshTick((value) => value + 1);
    },
    onError: (error) => handleWriteError("편집을 저장하지 못했어요", error),
  });

  useEffect(() => {
    const error = projectQuery.error;
    if (!(error instanceof ApiError) || error.status !== 404) {
      return;
    }
    pushToast({ title: "프로젝트를 찾을 수 없어요", tone: "error" });
    navigate("/", { replace: true });
  }, [navigate, projectQuery.error, pushToast]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    openFileTabsRef.current = openFileTabs;
  }, [openFileTabs]);

  useEffect(() => {
    clearSendPending(sendPendingTimeoutRef, setSendPending);
    autoFixRef.current = false;
    setAutoFixPending(false);
    setActiveTabId("design-system");
    setOpenFileTabs([]);
    setMode(null);
    setFocusedCommentId(null);
    setActiveSlideIdx(null);
    setEditTarget(null);
    setTweaksTarget(null);
    tweaksUndoRef.current = [];
    tweaksRedoRef.current = [];
    setDrawShapes([]);
    setDrawResetKey("");
    setPresentOpen(false);
    setDirectionActionError(null);
    setAuditFocus(null);
    setAuditRevealResult(null);
    setAuditActionError(null);
    turnTouchedFilesRef.current = false;
    setRefreshTick(0);
  }, [id]);

  useEffect(() => {
    setEditTarget(null);
    setTweaksTarget(null);
  }, [activeTabId]);

  const restoreMutation = useMutation({
    mutationFn: (turnId: string) => {
      const artifact = requireLoadedArtifacts(artifactsQuery.data);
      return restoreCheckpoint(id!, turnId, {
        expected_revision: artifact.current_revision,
        expected_artifact_digest: artifact.current_digest,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", id, "files"] }),
        queryClient.invalidateQueries({ queryKey: ["project", id, "artifacts"] }),
        invalidateDesignAudit(),
      ]);
      setRefreshTick((value) => value + 1);
      pushToast({ title: "이전 턴으로 되돌렸어요", tone: "info" });
    },
    onError: (error) => handleWriteError("턴을 되돌리지 못했어요", error),
  });

  const putDrawsMutation = useMutation({
    scope: { id: `project-draws:${id}` },
    mutationFn: ({
      relPath,
      svg,
      viewport,
    }: {
      relPath: string;
      svg: string;
      viewport: string;
    }) => {
      const artifact = requireLoadedArtifacts(artifactsQuery.data);
      return putProjectDraws(id!, relPath, svg, {
        revision: artifact.current_revision,
        digest: artifact.current_digest,
        viewport,
      });
    },
    onSuccess: (_data, variables) => {
      if (activeTabIdRef.current === variables.relPath) setDrawError(null);
    },
    onError: (err, variables) => {
      if (activeTabIdRef.current === variables.relPath) setDrawError("그리기를 저장하지 못했어요. 현재 그리기는 화면에 남아 있어요. 다시 시도해 주세요.");
      handleWriteError("그리기를 저장하지 못했어요", err);
    },
  });

  // Load saved draws for the current file tab. Computed inline from
  // openFileTabs so we don't depend on the `activeRelPath` that's
  // derived later in render after the early-return guard.
  useEffect(() => {
    if (!id) return;
    const tab = openFileTabs.find((t) => t.id === activeTabId);
    const relForDraws = tab?.kind === "file" ? tab.relPath ?? null : null;
    if (!relForDraws) {
      setDrawShapes([]);
      setDrawResetKey(`none:${activeTabId}`);
      setDrawLoading(false);
      setDrawError(null);
      return;
    }
    let cancelled = false;
    setDrawLoading(true);
    setDrawError(null);
    void (async () => {
      try {
        await drawSavesRef.current.get(`${id}:${relForDraws}`);
        const svg = await getProjectDraws(id, relForDraws);
        if (cancelled) return;
        setDrawShapes(deserializeDraws(svg));
        setDrawResetKey(`${id}:${relForDraws}:${Date.now()}`);
      } catch {
        if (cancelled) return;
        setDrawError("저장된 그리기를 불러오지 못했어요. 다시 불러온 뒤 편집해 주세요.");
      } finally {
        if (!cancelled) setDrawLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, activeTabId, openFileTabs, drawLoadAttempt]);

  // Escape는 현재 캔버스 모드를 끈다. 입력 필드 타이핑 중에는 무시해
  // 인스펙터/컴포저의 자체 Escape 동작을 방해하지 않는다.
  useEffect(() => {
    if (mode === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      setMode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // Global Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z for Draw mode — routes to
  // DrawLayer's internal undo/redo stack via ref. Draw shapes don't need
  // the server-round-trip that Tweaks needs because the layer is purely
  // frontend state; the serialized PUT only fires on commit.
  useEffect(() => {
    if (mode !== "draw" || drawBlocked) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) drawLayerRef.current?.redo();
      else drawLayerRef.current?.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, drawBlocked]);

  // Global Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z for Tweaks. Only fires when the
  // user isn't typing into an input / textarea / contentEditable so the
  // inspector's own value fields still undo natively.
  useEffect(() => {
    if (mode !== "tweaks" && mode !== "select") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          t.isContentEditable
        ) {
          return;
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      // Peek, don't pop: the frame only moves between the stacks once the
      // server has accepted the inverse patch (see applyTweaksHistory). That
      // makes a second keypress mid-flight read the same frame, so ignore it.
      if (tweaksMutation.isPending) return;
      if (e.shiftKey) {
        const frame = tweaksRedoRef.current.at(-1);
        if (!frame) return;
        tweaksMutation.mutate({
          relPath: frame.relPath,
          patch: { node_bg_id: frame.bg_id, styles: frame.forward },
          history: { kind: "redo" },
        });
      } else {
        const frame = tweaksUndoRef.current.at(-1);
        if (!frame) return;
        tweaksMutation.mutate({
          relPath: frame.relPath,
          patch: { node_bg_id: frame.bg_id, styles: frame.inverse },
          history: { kind: "undo" },
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, tweaksMutation]);

  const handleLiveEvent = useCallback((event: NormalizedEvent) => {
    if (autoFixRef.current && (event.type === "status.idle" || event.type === "status.error")) {
      autoFixRef.current = false;
      setAutoFixPending(false);
      if (event.type === "status.idle" && event.stopReason !== "error" && event.stopReason !== "interrupted") {
        void retryProjectDesignAudit(id ?? "").then(mergeDesignAuditCache).catch((error: unknown) => setAuditActionError(error instanceof Error ? error : new Error(String(error))));
      }
    }
    if (event.type === "design.direction_state") {
      mergeDirectionCache(parseDesignDirectionState(event.state));
    }
    if (
      event.type === "chat.user_message" ||
      event.type === "status.running" ||
      event.type === "status.error" ||
      event.type === "status.idle"
    ) {
      clearSendPending(sendPendingTimeoutRef, setSendPending);
    }

    if (event.type === "file.changed") turnTouchedFilesRef.current = true;
    if (event.type === "status.idle" && turnTouchedFilesRef.current) {
      turnTouchedFilesRef.current = false;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", id, "artifacts"] }),
        invalidateDesignAudit(),
      ]);
    }
    if (event.type === "status.error") turnTouchedFilesRef.current = false;

    if (event.type === "file.changed" && id) {
      openFileAsTab(event.path, setOpenFileTabs, setActiveTabId);
      if (activeTabIdRef.current === event.path) {
        setRefreshTick((value) => value + 1);
      }
      void queryClient.invalidateQueries({
        queryKey: ["project", id, "files"],
      });
    }

    // A CLI turn never emits file.changed — the backend collapses it into
    // one committed artifact.operation, which is what refreshes the
    // canvas and the file tabs after a turn (T2).
    if (event.type === "artifact.operation" && event.outcome === "committed") {
      turnTouchedFilesRef.current = true;
      if (id) {
        openChangedFilesAsTabs(
          event.changedPaths,
          openFileTabsRef.current.length > 0,
          setOpenFileTabs,
          setActiveTabId,
        );
        if (event.changedPaths.includes(activeTabIdRef.current)) {
          setRefreshTick((value) => value + 1);
        }
        void queryClient.invalidateQueries({
          queryKey: ["project", id, "files"],
        });
      }
    }

  }, [id, invalidateDesignAudit, mergeDirectionCache, mergeDesignAuditCache, queryClient]);
  const stream = useSessionEvents(sessionQuery.data?.id, handleLiveEvent);
  const events = useMemo(() => stream.state?.envelopes.map((item) => item.event) ?? [], [stream.state?.envelopes]);
  useEffect(() => {
    const latest = latestDirectionState(events);
    mergeDirectionCache(latest === null ? null : parseDesignDirectionState(latest));
  }, [events, mergeDirectionCache]);
  useEffect(() => {
    if (stream.state && sessionQuery.data?.backend_id !== stream.state.session.backend_id) {
      void stream.refreshSnapshot().catch(() => {});
    }
  }, [sessionQuery.data?.backend_id]);

  useEffect(() => {
    const project = projectQuery.data;
    if (!project || !project.entrypoint) return;
    openFileAsTab(project.entrypoint, setOpenFileTabs, setActiveTabId);
  }, [projectQuery.data]);

  const project = projectQuery.data ?? null;
  const graphicCanvas = useMemo(
    () => project === null
      ? null
      : parseProjectGraphicCanvas(project.type, project.options_json),
    [project],
  );
  const files: FileInfo[] = filesQuery.data ?? [];
  const artifacts = artifactsQuery.data ?? null;
  const session = stream.state?.session ?? null;
  const directionState = directionQuery.data ?? null;
  const directionActionPending =
    generateDirectionsMutation.isPending ||
    cancelDirectionsMutation.isPending ||
    retryDirectionsMutation.isPending ||
    selectDirectionMutation.isPending ||
    undoDirectionMutation.isPending;
  const directionError =
    directionActionError ??
    (directionState === null && directionQuery.error instanceof Error
      ? directionQuery.error
      : null);
  const directionLoading = directionState?.status === "loading";
  const chatComposerDisabled = sendPending || session?.status === "running";
  const composerDisabled = chatComposerDisabled || directionLoading || stream.error;

  // Turn clock. When the composer flips from idle to busy we stamp a
  // start time; a 1s ticker then drives re-renders so `canInterrupt`
  // flips on exactly once the configured threshold has elapsed.
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (chatComposerDisabled) {
      setTurnStartedAt((prev) => prev ?? Date.now());
    } else {
      setTurnStartedAt(null);
    }
  }, [chatComposerDisabled]);
  useEffect(() => {
    if (!chatComposerDisabled) return;
    const handle = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [chatComposerDisabled]);
  // 통제권 우선: 실행 중이면 5초 유예 뒤 항상 중단 가능. 턴 시작 시점에
  // 체크포인트를 뜨고 되돌리기가 있으므로 중단은 복구 가능한 동작이다.
  const turnElapsedMs =
    turnStartedAt == null ? null : Math.max(0, nowTs - turnStartedAt);
  const canInterrupt =
    chatComposerDisabled && turnElapsedMs != null && turnElapsedMs >= 5_000;

  const interruptMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error("no_session");
      return interruptSession(session.id);
    },
    onError: (err) => {
      pushToast({
        title: "작업을 중단하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });
  useEffect(() => {
    if (designAuditQuery.dataUpdatedAt > 0) setAuditActionError(null);
  }, [designAuditQuery.dataUpdatedAt]);
  const auditReport = designAuditQuery.data ?? null;
  const auditError = auditActionError ?? (designAuditQuery.error instanceof Error ? designAuditQuery.error : null);
  const auditState = designAuditViewState({
    renderable: Boolean(artifactsQuery.data?.entrypoint_url), report: auditReport,
    pending: designAuditQuery.isFetching, rerunning: retryDesignAuditMutation.isPending,
    errorCode: auditError === null ? null : designAuditErrorCode(auditError),
    currentDigest: artifactsQuery.data?.current_digest ?? "",
  });
  const openQuality = useCallback(() => {
    const detail = projectQuery.data;
    if (!artifactsQuery.data?.entrypoint_url || !detail) {
      pushToast({ title: "품질 점검을 열 수 없어요", body: "렌더링 가능한 결과물이 아직 없어요.", tone: "warn" });
      return;
    }
    if (!openFileTabs.some((tab) => tab.id === activeTabId)) openFileAsTab(detail.entrypoint, setOpenFileTabs, setActiveTabId);
    setMobilePane("workspace");
    setMode("quality");
  }, [activeTabId, artifactsQuery.data?.entrypoint_url, openFileTabs, projectQuery.data, pushToast]);
  const qualityGate = auditReport !== null && isDesignAuditCurrent(auditReport, artifactsQuery.data?.current_digest ?? "") && auditReport.overall_status === "must_fix"
    ? { mustFixCount: groupDesignAuditResult(auditReport).mustFix.length } : null;

  const handleQualityRevealResult = useCallback((nodeBgId: string, found: boolean) => {
    if (auditFocus?.nodeBgId === nodeBgId) setAuditRevealResult(found ? "found" : "not_found");
  }, [auditFocus?.nodeBgId]);

  const tabs = useMemo(
    () => buildTabs(project, openFileTabs),
    [openFileTabs, project],
  );
  const pendingPermissions = stream.state?.pending ?? [];

  const canvasSrc = useMemo(() => {
    const activeFile = tabs.find(
      (tab) => tab.id === activeTabId && tab.kind === "file" && tab.relPath,
    );
    const source = resolveCanvasSource({
      projectId: project?.id ?? null,
      activeRelPath: activeFile?.relPath ?? null,
      indexedRelPaths: filesQuery.isSuccess
        ? files.map((file) => file.rel_path)
        : null,
      entrypointUrl: artifacts?.entrypoint_url ?? null,
    });
    return source && canvasNavigation && canvasNavigation.projectId === project?.id && canvasNavigation.relPath === activeFile?.relPath ? canvasNavigation.url : source;
  }, [
    activeTabId,
    canvasNavigation,
    artifacts?.entrypoint_url,
    files,
    filesQuery.isSuccess,
    project?.id,
    tabs,
  ]);

  const handleCanvasNavigate = useCallback((href: string) => {
    if (!canvasSrc || !id) return;
    const target = resolveCanvasNavigation(href, new URL(canvasSrc, window.location.href).href, files.map((file) => file.rel_path));
    if (!target) {
      const missing = resolveCanvasPageTarget(href, new URL(canvasSrc, window.location.href).href);
      const active = tabs.find((tab) => tab.id === activeTabId && tab.kind === "file")?.relPath;
      const canCreate = missing !== null && active !== undefined && isSafeCanvasPagePath(missing.relPath) && isSafeCanvasPagePath(active);
      pushToast({
        title: "페이지를 열 수 없어요",
        body: "현재 프로젝트에 있는 HTML 페이지 링크인지 확인해 주세요.",
        tone: "warn",
        ...(canCreate ? { action: { label: "이 페이지 만들기", onSelect: () => {
          setComposerPrefill(`Create \`${missing.relPath}\` linked from \`${active}\`, sharing the same header/nav/footer`);
          setChatFocusKey((value) => value + 1);
          setMobilePane("chat");
        } } } : {}),
      });
      return;
    }
    setCanvasNavigation({ ...target, projectId: id });
    openFileAsTab(target.relPath, setOpenFileTabs, setActiveTabId);
  }, [activeTabId, canvasSrc, files, id, pushToast, tabs]);

  // File-level single-step undo (audit fix #7). Tracks per-file undo
  // availability and exposes it through the canvas top bar. Server
  // keeps the previous content of the last patched file in memory and
  // rolls back on POST /undo. The query key includes activeTabId so a
  // tab switch refetches; the patch / tweaks mutations invalidate
  // this key so a successful save flips canUndo from false → true.
  const undoActiveRelPath = useMemo<string | null>(() => {
    const activeFile = tabs.find(
      (tab) => tab.id === activeTabId && tab.kind === "file" && tab.relPath,
    );
    return activeFile?.relPath ?? null;
  }, [activeTabId, tabs]);
  const undoInfoQuery = useQuery({
    queryKey: ["project", id, "fs", undoActiveRelPath, "undo-info"] as const,
    queryFn: () => {
      if (!id || !undoActiveRelPath) {
        return { can_undo: false, stored_at: null };
      }
      return getFileUndoInfo(id, undoActiveRelPath);
    },
    enabled: Boolean(id && undoActiveRelPath),
  });
  const undoMutation = useMutation({
    mutationFn: () => {
      if (!id || !undoActiveRelPath) {
        throw new Error("no_active_file");
      }
      return undoLastFilePatch(id, undoActiveRelPath);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["project", id, "fs", undoActiveRelPath, "undo-info"],
        }),
        queryClient.invalidateQueries({ queryKey: ["project", id, "files"] }),
        queryClient.invalidateQueries({
          queryKey: ["project", id, "artifacts"],
        }),
        invalidateDesignAudit(),
      ]);
      setTweaksTarget(null);
      setTweakReview(null);
      setMode((current) => current === "quality" ? current : null);
      setRefreshTick((value) => value + 1);
      pushToast({ title: "마지막 저장을 실행 취소했어요", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "실행 취소하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    },
  });

  useEffect(() => {
    if (!tabs.find((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? "design-system");
    }
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (mode !== "quality") { setAuditFocus(null); setAuditRevealResult(null); }
  }, [mode]);
  useEffect(() => { setAuditFocus(null); setAuditRevealResult(null); }, [auditReport?.artifact_digest, auditReport?.created_at]);

  const loadQueries = [projectQuery, filesQuery, artifactsQuery, sessionQuery];
  const loadError = loadQueries.find((query) => query.error && (
    query.data === undefined || !isTransientProjectLoadError(query.error)
  ))?.error;
  const refreshError = loadQueries.find((query) => query.error)?.error;
  const isLoading = !loadError && (
    projectQuery.isLoading ||
    sessionQuery.isLoading ||
    filesQuery.isLoading ||
    artifactsQuery.isLoading || (Boolean(sessionQuery.data) && !stream.state && !stream.error));

  if (isLoading) {
    return (
      <div className="grid flex-1 place-items-center">
        <div className="text-sm text-muted-foreground">프로젝트를 불러오는 중...</div>
      </div>
    );
  }

  if (loadError || !project || !session || !artifacts) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
        <div className="max-w-md rounded-2xl border border-border bg-card p-7 text-center shadow-sm" role="alert">
          <h1 className="text-lg font-semibold">프로젝트를 열 수 없어요</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{loadError ? apiErrorCopy(loadError) : "연결을 확인하고 다시 시도해 주세요."}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button type="button" className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground" onClick={() => { void projectQuery.refetch(); void sessionQuery.refetch(); void filesQuery.refetch(); void artifactsQuery.refetch(); stream.retry(); }}>다시 시도</button>
            <button type="button" className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted" onClick={() => navigate("/")}>홈으로</button>
          </div>
        </div>
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const activeRelPath =
    activeTab?.kind === "file" && activeTab.relPath ? activeTab.relPath : null;
  const comments = commentsQuery.data ?? [];
  const sendMessage = async (text: string, attachedFiles: readonly ReadyAttachmentSource[], signal: AbortSignal, generation?: GenerationOptions) => {
            if (composerDisabled) {
              return;
            }
            // The backend persists+publishes a `chat.user_message` normalized
            // event as the first step of runUserTurn, so it echoes back
            // through SSE within ~10ms on localhost. No optimistic local
            // state needed — and this way history survives a page reload.
            setSendPending(true);
            armSendPendingFallback(sendPendingTimeoutRef, setSendPending);

            try {
              await sendUserEvent(session.id, {
                type: "user.message",
                text,
                files: attachedFiles,
                ...(activeRelPath === null ? {} : { active_rel_path: activeRelPath }),
                generation,
              }, { signal });
            } catch (error) {
              clearSendPending(sendPendingTimeoutRef, setSendPending);
              if (!(error instanceof DOMException && error.name === "AbortError")) {
                pushToast({
                  title:
                    error instanceof ApiError && error.status === 409
                      ? "이미 실행 중인 턴이 있어요"
                      : "메시지를 보내지 못했어요",
                  body: visualSourceSendErrorCopy(error),
                  tone: "error",
                });
              }
              throw error;
            }

  };
  const requestCommentEdit = async (comment: Comment, body: string) => {
    if (composerDisabled) throw new Error("session_not_ready");
    const known = comments.find((entry) => entry.id === comment.id);
    if (!known || known.resolved_at !== null || !body.trim()) throw new Error("comment_target_unavailable");
    await saveAndRequestCommentEdit(() => updateCommentMutation.mutateAsync({ commentId: known.id, patch: { body } }), async (persisted, text) => {
      if (!files.some((file) => file.rel_path === persisted.rel_path)) throw new Error("comment_target_unavailable");
      await sendMessage(text, [], new AbortController().signal, (await loadComposerDraft(session.id).catch(() => null))?.generation);
    });
    setChatFocusKey((value) => value + 1);
    setMobilePane("chat");
  };

  const requestQualityFix = async () => {
    if (composerDisabled || autoFixRef.current || !auditReport || safeFixMutation.isPending || designAuditQuery.isFetching || !isDesignAuditCurrent(auditReport, artifacts.current_digest)) return;
    autoFixRef.current = true;
    setAutoFixPending(true);
    try {
      const latest = await getArtifacts(id!);
      if (!isDesignAuditCurrent(auditReport, latest.current_digest)) {
        throw new ApiError("stale_artifact_identity", "Artifact changed", 409);
      }
      const generation = (await loadComposerDraft(session.id).catch(() => null))?.generation;
      await sendMessage(qualityFixRequest(auditReport), [], new AbortController().signal, generation);
      setChatFocusKey((value) => value + 1);
      setMobilePane("chat");
    } catch (error) {
      autoFixRef.current = false;
      setAutoFixPending(false);
      handleWriteError("자동 수정을 시작하지 못했어요", error);
    }
  };


  const handleApplyTweak = (patch: Partial<Record<TweaksStyleKey, string | null>>) => {
    if (!activeRelPath || !tweaksTarget || tweaksMutation.isPending) return;
    setTweakReview(buildTweakChangePreview(tweaksTarget, patch));
    tweaksMutation.mutate({
      relPath: activeRelPath,
      patch: { node_bg_id: tweaksTarget.bg_id, styles: patch },
      history: {
        kind: "apply",
        frame: buildTweaksUndoFrame(tweaksTarget, activeRelPath, patch),
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {refreshError && <div role="alert" aria-label="작업 정보 새로고침 오류" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"><span>최신 작업 정보를 불러오지 못했어요. 작성 중인 내용은 유지돼요.</span><button type="button" className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium" onClick={() => { for (const query of loadQueries) if (query.isError) void query.refetch(); }}>작업 정보 다시 불러오기</button></div>}
      {stream.error && <div role="alert" className="flex items-center justify-between bg-warning/15 px-4 py-2 text-sm"><span>실시간 연결이 끊겼어요. 다시 연결하는 중이에요.</span><button type="button" className="rounded border px-3 py-2" onClick={stream.retry}>다시 연결</button></div>}
      <ProjectTopBar
        chatCollapsed={chatCollapsed}
        onToggleChat={() => setChatCollapsed((value) => !value)}
        project={project}
        canPresent={
          project.type === "slide_deck" &&
          activeTab?.kind === "file" &&
          Boolean(canvasSrc)
        }
        onPresent={() => setPresentOpen(true)}
        qualityGate={qualityGate}
        onOpenQuality={openQuality}
        tabsSlot={
          <ArtifactTabs
            tabs={tabs}
            activeId={activeTabId}
            onSelect={(tabId) => { setActiveTabId(tabId); setMobilePane("workspace"); }}
            onClose={(tabId) => {
              setOpenFileTabs((current) =>
                current.filter((tab) => tab.id !== tabId),
              );
              if (activeTabId === tabId) {
                setActiveTabId("design-system");
              }
            }}
          />
        }
      />
      <div className="flex shrink-0 gap-2 border-b border-border bg-background p-2 min-[901px]:hidden" aria-label="작업 영역 전환">
        <button type="button" aria-pressed={mobilePane === "workspace"} aria-controls="project-workspace-pane" onClick={() => setMobilePane("workspace")} className={cn("flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium", mobilePane === "workspace" ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted")}><Monitor className="h-4 w-4" aria-hidden="true" />작업 화면</button>
        <button type="button" aria-pressed={mobilePane === "chat"} aria-controls="project-chat-pane" onClick={() => setMobilePane("chat")} className={cn("flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium", mobilePane === "chat" ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted")}><MessageSquare className="h-4 w-4" aria-hidden="true" />AI 대화{session.status === "running" && <span className="h-2 w-2 rounded-full bg-accent" aria-label="AI 작업 중" />}</button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div id="project-chat-pane" className={cn("min-h-0 shrink-0 max-[900px]:flex-1", mobilePane !== "chat" && "max-[900px]:hidden", chatCollapsed && "min-[901px]:hidden")}>
        <ChatPane
          chatFocusKey={chatFocusKey}
          events={events}
          session={session}
          projectFiles={files}
          comments={comments}
          onRequestCommentEdit={requestCommentEdit}
          commentEditDisabled={composerDisabled}
          activeRelPath={activeRelPath}
          activeSlideIdx={activeSlideIdx}
          focusedCommentId={focusedCommentId}
          onFocusComment={setFocusedCommentId}
          onUpdateCommentBody={(commentId, body) =>
            updateCommentMutation.mutate({ commentId, patch: { body } })
          }
          onToggleCommentResolved={(commentId, resolved) =>
            updateCommentMutation.mutate({ commentId, patch: { resolved } })
          }
          composerDisabled={composerDisabled}
          canInterrupt={canInterrupt}
          turnElapsedMs={turnElapsedMs}
          interruptPending={interruptMutation.isPending}
          onInterrupt={() => interruptMutation.mutate()}
          composerInitialText={composerPrefill}
          activePageLabel={activeRelPath !== null && activeRelPath !== project.entrypoint ? `보고 있는 페이지: ${activeRelPath}` : null}
          statusSlot={
            <DirectionStatusBar
              state={directionState}
              cancelPending={cancelDirectionsMutation.isPending}
              onOpen={() => { setActiveTabId("directions"); setMobilePane("workspace"); }}
              onCancel={() => cancelDirectionsMutation.mutate()}
            />
          }
          onSend={sendMessage}
          onOpenFile={(relPath) => {
            openFileAsTab(relPath, setOpenFileTabs, setActiveTabId);
            setMobilePane("workspace");
          }}
          onRevertTurn={(turnId) => restoreMutation.mutate(turnId)}
          revertingTurnId={
            restoreMutation.isPending
              ? (restoreMutation.variables as string | undefined) ?? null
              : null
          }
        />
        </div>
        <div id="project-workspace-pane" className={cn("flex min-h-0 min-w-0 flex-1", mobilePane !== "workspace" && "max-[900px]:hidden")}>

        {activeTab?.kind === "design_system" && (
          <DesignSystemView
            systemIdOverride={project.design_system_id ?? undefined}
          />
        )}

        {activeTab?.kind === "design_files" && (
          <DesignFilesView
            projectId={id!}
            files={files}
            onOpenInCanvas={(relPath) =>
              openFileAsTab(relPath, setOpenFileTabs, setActiveTabId)
            }
          />
        )}

        {activeTab?.kind === "directions" && (
          <DirectionsView
            state={directionState}
            recovering={directionQuery.isLoading}
            actionPending={directionActionPending}
            cancelPending={cancelDirectionsMutation.isPending}
            error={directionError}
            onGenerate={() => generateDirectionsMutation.mutate()}
            onCancel={() => cancelDirectionsMutation.mutate()}
            onRetry={() => retryDirectionsMutation.mutate()}
            onSelect={(directionId) => {
              if (directionState === null) return;
              selectDirectionMutation.mutate({
                generationId: directionState.generation_id,
                revision: directionState.selection_revision,
                directionId,
              });
            }}
            onUndo={() => {
              if (directionState === null) return;
              undoDirectionMutation.mutate({
                generationId: directionState.generation_id,
                revision: directionState.selection_revision,
              });
            }}
          />
        )}

        {activeTab?.kind === "file" && (
          <div className="flex min-h-0 min-w-0 flex-1 max-[1000px]:flex-col">
            <Canvas
              colorPalette={activeRelPath && /\.html?$/i.test(activeRelPath) ? <div className="flex items-center gap-2">
                {project.type === "prototype" && artifacts.pages.length > 1 ? <label className="flex items-center gap-1.5 text-xs text-muted-foreground">페이지<select aria-label="캔버스 페이지" value={activeRelPath} className="h-8 max-w-44 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={(event) => openFileAsTab(event.target.value, setOpenFileTabs, setActiveTabId)}>{artifacts.pages.map((page) => <option key={page.rel_path} value={page.rel_path}>{page.title}</option>)}</select></label> : null}
                <ColorPalette
                  key={activeRelPath}
                  projectId={id!}
                  relPath={activeRelPath}
                  refreshKey={`${artifacts.current_digest}:${refreshTick}`}
                  disabled={composerDisabled || tweaksMutation.isPending || patchFileMutation.isPending || undoMutation.isPending}
                  onSaved={() => {
                    setRefreshTick((value) => value + 1);
                    setTweaksTarget(null);
                    tweaksUndoRef.current = [];
                    tweaksRedoRef.current = [];
                    void queryClient.invalidateQueries({ queryKey: ["project", id] });
                  }}
                />
              </div> : undefined}
              sceneTools={activeRelPath && /\.html?$/i.test(activeRelPath) ? <Suspense fallback={<p role="status" className="p-3 text-sm">3D 도구를 불러오는 중…</p>}><ThreeScenePanel
                key={activeRelPath}
                projectId={id!}
                relPath={activeRelPath}
                disabled={composerDisabled}
                onSaved={() => {
                  setRefreshTick((value) => value + 1);
                  void queryClient.invalidateQueries({ queryKey: ["project", id] });
                }}
                onRequestAI={async (text) => { await sendMessage(text, [], new AbortController().signal, (await loadComposerDraft(session.id).catch(() => null))?.generation); setChatFocusKey((value) => value + 1); setMobilePane("chat"); }}
              /></Suspense> : undefined}
              mode={mode}
              src={canvasSrc}
              onNavigate={handleCanvasNavigate}
              frameKey={`${canvasSrc ?? "entrypoint"}:${refreshTick}`}
              onModeChange={setMode}
              onRefresh={() => {
                if (!id) return;
                refreshMutation.mutate();
              }}
              canUndo={Boolean(undoInfoQuery.data?.can_undo)}
              undoPending={undoMutation.isPending}
              onUndo={() => undoMutation.mutate()}
              qualityFocusedNodeId={auditFocus?.relPath === activeRelPath ? auditFocus.nodeBgId : null}
              onQualityRevealResult={handleQualityRevealResult}
              graphicCanvas={graphicCanvas}
              comments={comments}
              activeRelPath={activeRelPath}
              activeSlideIdx={activeSlideIdx}
              focusedCommentId={focusedCommentId}
              onCreateComment={(input) => {
                if (!activeRelPath) return;
                createCommentMutation.mutate({
                  rel_path: activeRelPath,
                  ...input,
                });
              }}
              onFocusComment={setFocusedCommentId}
              onActiveSlideChange={setActiveSlideIdx}
              editSelectedBgId={editTarget?.bg_id ?? null}
              onSelectEditTarget={setEditTarget}
              tweaksSelectedBgId={tweaksTarget?.bg_id ?? null}
              tweaksTarget={tweaksTarget}
              tweaksSaving={tweaksMutation.isPending}
              onApplyTweak={handleApplyTweak}
              onSelectTweaksTarget={setTweaksTarget}
              drawTool={drawTool}
              drawColor={drawColor}
              drawStrokeWidth={drawStrokeWidth}
              drawInitialShapes={drawShapes}
              drawResetKey={drawResetKey}
              drawLoading={drawLoading}
              drawError={drawError}
              onRetryDraws={() => {
                if (putDrawsMutation.isPending) return;
                if (putDrawsMutation.isError && putDrawsMutation.variables?.relPath === activeRelPath) {
                  putDrawsMutation.mutate(putDrawsMutation.variables);
                } else setDrawLoadAttempt((value) => value + 1);
              }}
              drawLayerRef={drawLayerRef}
              onCommitDraws={(shapes) => {
                if (drawBlocked) return;
                setDrawShapes(shapes);
                if (!activeRelPath) return;
                const rect = document
                  .querySelector("iframe")
                  ?.getBoundingClientRect();
                const width = rect?.width ?? 1280;
                const height = rect?.height ?? 720;
                const svg = serializeDraws(width, height, shapes);
                const save = putDrawsMutation.mutateAsync({
                  relPath: activeRelPath,
                  svg,
                  viewport: `${Math.round(width)}x${Math.round(height)}`,
                });
                const key = `${id}:${activeRelPath}`;
                drawSavesRef.current.set(key, save);
                void save.catch(() => {}).finally(() => {
                  if (drawSavesRef.current.get(key) === save) drawSavesRef.current.delete(key);
                });
              }}
            />
            <ModePanel
              mode={mode}
              uxReview={{
                projectId: id!,
                relPath: activeRelPath,
                digest: artifacts.current_digest,
                revision: project.current_revision,
                disabled: composerDisabled,
                onRequestAI: async (text, signal) => {
                  if (composerDisabled || signal.aborted) throw new Error("session_not_ready");
                  const generation = (await loadComposerDraft(session.id).catch(() => null))?.generation ?? { model: "", effort: "low" as const, vanilla: true, provider: "native" as const };
                  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
                  await sendMessage(text, [], signal, generation);
                  setChatFocusKey((value) => value + 1);
                  setMobilePane("chat");
                },
              }}
              quality={{
                onAutoFix: () => { void requestQualityFix(); },
                autoFixPending,
                autoFixDisabled: Boolean(composerDisabled),
                state: auditState,
                pendingFindingId: safeFixMutation.isPending ? safeFixMutation.variables?.findingId ?? null : null,
                focusedFindingId: auditFocus?.findingId ?? null,
                revealResult: auditRevealResult,
                onRetry: () => { if (!safeFixMutation.isPending && !designAuditQuery.isFetching && !retryDesignAuditMutation.isPending) retryDesignAuditMutation.mutate(); },
                onOpenFile: (finding) => openFileAsTab(finding.source.rel_path, setOpenFileTabs, setActiveTabId),
                onReveal: (finding) => {
                  openFileAsTab(finding.source.rel_path, setOpenFileTabs, setActiveTabId);
                  setMode("quality");
                  if (finding.source.node_bg_id !== null) {
                    setAuditFocus({ findingId: finding.id, nodeBgId: finding.source.node_bg_id, relPath: finding.source.rel_path });
                    setAuditRevealResult(null);
                  }
                },
                onApplySafeFix: (finding) => {
                  if (finding.safe_fix === undefined || auditReport === null || designAuditQuery.isFetching || retryDesignAuditMutation.isPending || safeFixMutation.isPending || !isDesignAuditCurrent(auditReport, artifacts.current_digest)) return;
                  openFileAsTab(finding.safe_fix.rel_path, setOpenFileTabs, setActiveTabId);
                  if (finding.source.node_bg_id !== null) setAuditFocus({ findingId: finding.id, nodeBgId: finding.source.node_bg_id, relPath: finding.source.rel_path });
                  safeFixMutation.mutate({ findingId: finding.id, relPath: finding.safe_fix.rel_path, request: finding.safe_fix.request });
                },
              }}
              comments={comments}
              onRequestCommentEdit={requestCommentEdit}
              commentEditDisabled={composerDisabled}
              activeRelPath={activeRelPath}
              activeSlideIdx={activeSlideIdx}
              focusedCommentId={focusedCommentId}
              onFocusComment={setFocusedCommentId}
              onUpdateCommentBody={(commentId, body) =>
                updateCommentMutation.mutate({
                  commentId,
                  patch: { body },
                })
              }
              onToggleCommentResolved={(commentId, resolved) =>
                updateCommentMutation.mutate({
                  commentId,
                  patch: { resolved },
                })
              }
              editTarget={editTarget}
              editSaving={patchFileMutation.isPending}
              onSaveEdit={(patch) => {
                if (!activeRelPath || !editTarget) return;
                patchFileMutation.mutate({
                  relPath: activeRelPath,
                  patch: {
                    node_bg_id: editTarget.bg_id,
                    ...patch,
                  },
                });
              }}
              onClearEdit={() => setEditTarget(null)}
              tweaksTarget={tweaksTarget}
              tweakReview={tweakReview}
              tweaksSaving={tweaksMutation.isPending}
              onApplyTweak={handleApplyTweak}
              onResetTweaks={() => {
                if (!activeRelPath || !tweaksTarget) return;
                const keys = Object.keys(tweaksTarget.inline);
                if (keys.length === 0) return;
                const patch: Record<string, null> = {};
                for (const k of keys) patch[k] = null;
                tweaksMutation.mutate({
                  relPath: activeRelPath,
                  patch: {
                    node_bg_id: tweaksTarget.bg_id,
                    styles: patch,
                  },
                  history: {
                    kind: "apply",
                    frame: buildTweaksUndoFrame(
                      tweaksTarget,
                      activeRelPath,
                      patch as Partial<Record<TweaksStyleKey, string | null>>,
                    ),
                  },
                });
              }}
              onClearTweaks={() => {
                setTweaksTarget(null);
                setTweakReview(null);
              }}
              drawTool={drawTool}
              drawColor={drawColor}
              drawStrokeWidth={drawStrokeWidth}
              drawHasShapes={!drawBlocked && drawShapes.length > 0}
              onChangeDrawTool={setDrawTool}
              onChangeDrawColor={setDrawColor}
              onChangeDrawWidth={setDrawStrokeWidth}
              onUndoDraw={() => { if (!drawBlocked) drawLayerRef.current?.undo(); }}
              onRedoDraw={() => { if (!drawBlocked) drawLayerRef.current?.redo(); }}
              onClearDraw={() => { if (!drawBlocked) drawLayerRef.current?.clear(); }}
            />
          </div>
        )}
        </div>
      </div>
      <PermissionDialog
        request={pendingPermissions[0] ?? null}
        pending={toolDecisionMutation.isPending}
        onDecide={(decision) => {
          const head = pendingPermissions[0];
          if (!head) return;
          toolDecisionMutation.mutate({
            toolCallId: head.toolCallId,
            decision,
          });
        }}
      />
      {presentOpen && canvasSrc && (
        <PresentOverlay
          src={canvasSrc}
          onClose={() => setPresentOpen(false)}
        />
      )}
    </div>
  );
}

function isTransientProjectLoadError(error: Error): boolean {
  if (error instanceof ApiError) return error.status === 0 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError;
}

function buildTabs(
  project: ProjectDetail | null,
  openFileTabs: ArtifactTab[],
): ArtifactTab[] {
  return [
    {
      id: "design-system",
      title: project?.design_system_name ?? "디자인 시스템",
      kind: "design_system",
      closeable: false,
    },
    {
      id: "directions",
      title: "방향 정하기",
      kind: "directions",
      closeable: false,
    },
    {
      id: "design-files",
      title: "디자인 파일",
      kind: "design_files",
      closeable: false,
    },
    ...openFileTabs,
  ];
}

function openFileAsTab(
  relPath: string,
  setOpenFileTabs: Dispatch<SetStateAction<ArtifactTab[]>>,
  setActiveTabId: Dispatch<SetStateAction<string>>,
) {
  // Reject empty / whitespace-only paths — they'd surface as a canvas tab
  // pointing to `/api/projects/X/fs/` and spam the network with 404s.
  if (!relPath || !relPath.trim()) return;
  setOpenFileTabs((current) => {
    if (current.some((tab) => tab.relPath === relPath)) return current;
    return [
      ...current,
      {
        id: relPath,
        title: relPath.split("/").pop() ?? relPath,
        kind: "file",
        relPath,
        closeable: true,
      },
    ];
  });
  setActiveTabId(relPath);
}

/**
 * Turn-completion tab sync. A finished turn arrives as one
 * `artifact.operation` event listing every changed path, so open the HTML
 * ones as tabs but leave the user's active tab alone unless nothing is open.
 */
function openChangedFilesAsTabs(
  relPaths: readonly string[],
  hasOpenFileTab: boolean,
  setOpenFileTabs: Dispatch<SetStateAction<ArtifactTab[]>>,
  setActiveTabId: Dispatch<SetStateAction<string>>,
) {
  const paths = relPaths.filter((relPath) => /\.html?$/i.test(relPath));
  if (paths.length === 0) return;
  setOpenFileTabs((current) => {
    const next = current.slice();
    for (const relPath of paths) {
      if (next.some((tab) => tab.relPath === relPath)) continue;
      next.push({
        id: relPath,
        title: relPath.split("/").pop() ?? relPath,
        kind: "file",
        relPath,
        closeable: true,
      });
    }
    return next.length === current.length ? current : next;
  });
  if (!hasOpenFileTab) setActiveTabId(paths[0]!);
}

/** Guard for writes that must carry the canvas identity the user saw. */
function requireLoadedArtifacts(
  artifacts: ArtifactSummary | undefined,
): ArtifactSummary {
  if (!artifacts) {
    throw new Error("캔버스 정보를 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요");
  }
  return artifacts;
}

/**
 * Undo frame for Tweaks mode. Capture the style values that WERE there so
 * Cmd/Ctrl+Z can re-emit the inverse PATCH. `forward` is the original
 * change so Cmd/Ctrl+Shift+Z can replay it after an undo.
 */
interface TweaksUndoFrame {
  bg_id: string;
  relPath: string;
  forward: Partial<Record<TweaksStyleKey, string | null>>;
  inverse: Partial<Record<TweaksStyleKey, string | null>>;
}

type TweaksHistoryIntent =
  | { readonly kind: "apply"; readonly frame: TweaksUndoFrame }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" };

/**
 * Moves the undo/redo stacks only after the server accepted the patch — a
 * rejected PATCH must not leave a frame describing a change that never
 * landed.
 */
function applyTweaksHistory(
  intent: TweaksHistoryIntent | undefined,
  undoStack: MutableRefObject<TweaksUndoFrame[]>,
  redoStack: MutableRefObject<TweaksUndoFrame[]>,
) {
  if (intent === undefined) return;
  if (intent.kind === "apply") {
    undoStack.current.push(intent.frame);
    redoStack.current = [];
    return;
  }
  const from = intent.kind === "undo" ? undoStack : redoStack;
  const to = intent.kind === "undo" ? redoStack : undoStack;
  const frame = from.current.pop();
  if (frame !== undefined) to.current.push(frame);
}

function buildTweaksUndoFrame(
  target: TweaksTarget,
  relPath: string,
  patch: Partial<Record<TweaksStyleKey, string | null>>,
): TweaksUndoFrame {
  const inverse: Partial<Record<TweaksStyleKey, string | null>> = {};
  for (const key of Object.keys(patch) as TweaksStyleKey[]) {
    const prev = target.inline[key];
    inverse[key] = prev === undefined ? null : prev;
  }
  return {
    bg_id: target.bg_id,
    relPath,
    forward: patch,
    inverse,
  };
}

function mergeTweaksTargetInline(
  target: TweaksTarget,
  patch: Record<string, string | null>,
): TweaksTarget {
  const nextInline = { ...target.inline };
  for (const [key, value] of Object.entries(patch)) {
    const k = key as TweaksStyleKey;
    if (value === null) {
      delete nextInline[k];
    } else {
      nextInline[k] = value;
    }
  }
  return { ...target, inline: nextInline };
}

function applyEditPatch(
  target: EditTarget,
  patch: PatchFileRequest,
): EditTarget {
  const nextAttributes = { ...target.attributes };
  for (const [key, value] of Object.entries(patch.attributes ?? {})) {
    if (value === null) {
      delete nextAttributes[key];
    } else {
      nextAttributes[key] = value;
    }
  }

  return {
    ...target,
    text: patch.text ?? target.text,
    attributes: nextAttributes,
  };
}

function clearSendPending(
  timerRef: MutableRefObject<number | null>,
  setSendPending: Dispatch<SetStateAction<boolean>>,
) {
  if (timerRef.current != null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  setSendPending(false);
}

function armSendPendingFallback(
  timerRef: MutableRefObject<number | null>,
  setSendPending: Dispatch<SetStateAction<boolean>>,
) {
  if (timerRef.current != null) {
    window.clearTimeout(timerRef.current);
  }
  timerRef.current = window.setTimeout(() => {
    timerRef.current = null;
    setSendPending(false);
  }, 5000);
}
