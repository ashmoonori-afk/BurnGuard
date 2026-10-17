import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { surfaceForProjectType, type Comment, type GraphicCanvasV1, type ProjectType } from "@bg/shared";
import { BarChart3, Box, Hand, Info, Minus, Plus } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import CanvasTopBar from "./CanvasTopBar";
import CommentLayer from "./CommentLayer";
import QuickComment from "./QuickComment";
import type { CommentPinInput, CommentPoint } from "./quick-comment";
import type { Ref, ReactNode } from "react";
import DrawLayer, {
  type DrawHistoryAvailability,
  type DrawLayerHandle,
  type DrawShape,
  type DrawTool,
} from "./DrawLayer";
import EditLayer, { type EditTarget } from "./EditLayer";
import TweaksLayer, { type TweaksStyleKey, type TweaksTarget } from "./TweaksLayer";
import QualityLayer from "./QualityLayer";
import GraphicFrameNavigator from "./GraphicFrameNavigator";
import {
  buildSandboxedArtifactSrcDoc,
  openFrameExternalLink,
  parseFramePreviewReport,
  requestFrameScrollPosition,
  requestFrameSetActiveSlide,
  requestFrameSetScrollPosition,
  requestFramePreviewReport,
  subscribeFrameEvent,
  type FrameScrollPosition,
} from "./frame-bridge";
import type { CanvasMode } from "@/components/modes/types";
import { authorizedFetch } from "@/api/client";
import { embedCanvasImages } from "@/lib/canvas-images";
import { canvasLoadErrorKey } from "@/lib/canvas-load-error";
import { anySignal } from "@/lib/abort-signal";
import { hydrateCanvasCharts } from "@/lib/canvas-charts";
import { canvasPoint } from "./canvas-coordinates";
import { requestFrameScrollAtPoint } from "./frame-bridge";

import { MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM, zoomCanvasAt } from "./canvas-zoom";
import { useT } from "@/i18n/t";
import { useLocaleStore } from "@/i18n/locale";
import { canvasPlaceholderKeys, canvasRenderingVisible } from "@/lib/canvas-placeholder";
import { canvasDeviceWidth, type CanvasDevicePreset } from "@/lib/canvas-device-width";

const VIEWPORT_BUTTON = "inline-flex h-8 shrink-0 items-center justify-center rounded-control px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent";
const VIEWPORT_ICON_BUTTON = cn(VIEWPORT_BUTTON, "w-8 px-0");

function themeColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const triple = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return triple === "" ? fallback : `rgb(${triple})`;
}

function buildPlaceholderSrc(locale: string, title: string, subtitle: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      background: ${themeColor("--muted", "Canvas")};
      color: ${themeColor("--foreground", "CanvasText")};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif;
      display: grid;
      place-items: center;
      min-height: 100vh;
      word-break: keep-all;
    }
    .wrap { box-sizing: border-box; text-align: center; padding: clamp(8px, 4vmin, 48px); width: 480px; max-width: 100%; overflow-wrap: anywhere; }
    .eyebrow {
      color: ${themeColor("--accent", "LinkText")};
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    .title { font-size: clamp(14px, 4vmin, 22px); font-weight: 700; margin: 0; }
    .subtitle {
      color: ${themeColor("--muted-foreground", "GrayText")};
      font-size: clamp(12px, 3vmin, 14px);
      line-height: 1.6;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <section class="wrap">
    <div class="eyebrow">BurnGuard Canvas</div>
    <h1 class="title">${title}</h1>
    <p class="subtitle">${subtitle}</p>
  </section>
</body>
</html>`;
}

/**
 * Outcome of the report attempt for the document currently in the frame.
 * Exposed as a data attribute so a real browser can tell a report that never
 * happened from one the server refused; it carries no user-facing copy.
 */
type PreviewReportState = "accepted" | "unavailable" | "failed" | `refused_${number}`;

export default function Canvas({
  projectType,
  mode,
  src,
  loading = false,
  working = false,
  frameKey,
  onModeChange,
  onRefresh,
  onNavigate,
  comments,
  activeRelPath,
  activeSlideIdx,
  focusedCommentId,
  onCreateComment,
  onQuickCreateComment,
  renderQuickComment,
  onFocusComment,
  editSelectedBgId,
  onSelectEditTarget,
  tweaksSelectedBgId,
  tweaksTarget,
  tweaksSaving,
  onApplyTweak,
  onSelectTweaksTarget,
  drawTool,
  drawColor,
  drawStrokeWidth,
  drawInitialShapes,
  drawResetKey,
  drawLayerRef,
  onCommitDraws,
  onDrawHistoryChange,
  onActiveSlideChange,
  canUndo,
  undoPending,
  onUndo,
  qualityFocusedNodeId,
  onQualityRevealResult,
  graphicCanvas,
  drawLoading = false,
  drawError = null,
  onRetryDraws,
  sceneTools,
  chartTools,
  historyTools,
  colorPalette,
  livePreview,
}: {
  projectType?: ProjectType;
  mode: CanvasMode | null;
  src?: string | null;
  loading?: boolean;
  /** A turn is running; with nothing renderable yet the placeholder says so instead of "loading". */
  working?: boolean;
  frameKey?: string;
  onModeChange: (m: CanvasMode | null) => void;
  onRefresh: () => void;
  onNavigate?: (href: string) => void;
  comments: Comment[];
  activeRelPath: string | null;
  activeSlideIdx: number | null;
  focusedCommentId: string | null;
  onCreateComment: (input: CommentPinInput) => void;
  onQuickCreateComment: (input: CommentPinInput) => Promise<Comment>;
  renderQuickComment: (comment: Comment, close: () => void) => ReactNode;
  onFocusComment: (id: string | null) => void;
  editSelectedBgId: string | null;
  onSelectEditTarget: (target: EditTarget | null) => void;
  tweaksSelectedBgId: string | null;
  tweaksTarget: TweaksTarget | null;
  tweaksSaving: boolean;
  onApplyTweak: (patch: Partial<Record<TweaksStyleKey, string | null>>) => void;
  onSelectTweaksTarget: (target: TweaksTarget | null) => void;
  drawTool: DrawTool;
  drawColor: string;
  drawStrokeWidth: number;
  drawInitialShapes: DrawShape[];
  drawResetKey: string;
  drawLayerRef: Ref<DrawLayerHandle>;
  onCommitDraws: (shapes: DrawShape[]) => void;
  onDrawHistoryChange?: (state: DrawHistoryAvailability) => void;
  onActiveSlideChange: (value: number | null) => void;
  /** Audit fix #7 — file-level single-step undo for the active artifact. */
  canUndo?: boolean;
  undoPending?: boolean;
  onUndo?: () => void;
  qualityFocusedNodeId: string | null;
  onQualityRevealResult: (nodeBgId: string, found: boolean) => void;
  graphicCanvas?: GraphicCanvasV1 | null;
  drawLoading?: boolean;
  drawError?: string | null;
  onRetryDraws?: () => void;
  sceneTools?: ReactNode;
  chartTools?: ReactNode;
  historyTools?: ReactNode;
  colorPalette?: ReactNode;
  livePreview?: { version: number; reportUrl: string };
}) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const placeholderKeys = canvasPlaceholderKeys({ src, loading, working });
  const placeholderSrc = buildPlaceholderSrc(locale, t(placeholderKeys.title), t(placeholderKeys.subtitle));
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedComment, setSelectedComment] = useState<{ documentKey: string; comment: Comment; point: CommentPoint } | null>(null);
  const frameLoadKey = JSON.stringify([src, frameKey]);
  const [frameDocument, setFrameDocument] = useState<{ key: string; src: string; html: string } | null>(null);
  // Retain the previous version while fetching, but never reuse its browsing
  // context for a different document or a loading placeholder.
  const frameSrcDoc = frameDocument && frameDocument.src === src ? frameDocument.html : null;
  const frameDocumentKey = frameDocument && frameDocument.src === src ? frameDocument.key : `placeholder:${src ?? ""}`;
  const [zoom, setZoom] = useState(1);
  const [devicePreset, setDevicePreset] = useState<CanvasDevicePreset>("fit");
  const deviceWidth = projectType === undefined ? undefined : canvasDeviceWidth(projectType, devicePreset);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef({ zoom, pan });
  viewportRef.current = { zoom, pan };
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || iframeRef.current?.dataset.documentKey !== frameDocumentKey) return;
    const zoomAt = (x: number, y: number, delta: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || ![x, y, delta].every(Number.isFinite)) return;
      const current = viewportRef.current;
      const next = zoomCanvasAt(current.zoom, current.pan, { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 }, delta);
      viewportRef.current = next; setZoom(next.zoom); setPan(next.pan);
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      zoomAt(event.clientX, event.clientY, event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1));
    };
    container.addEventListener("wheel", wheel, { passive: false, capture: true });
    const unsubscribe = subscribeFrameEvent(iframeRef.current, "viewport-wheel", (payload) => {
      if (!payload || ![payload.x, payload.y, payload.delta].every(value => typeof value === "number" && Number.isFinite(value))) return;
      const frame = iframeRef.current;
      const rect = frame?.getBoundingClientRect();
      if (!rect || !frame || payload.x < 0 || payload.y < 0 || payload.x > frame.clientWidth || payload.y > frame.clientHeight) return;
      zoomAt(rect.left + payload.x * rect.width / frame.clientWidth, rect.top + payload.y * rect.height / frame.clientHeight, payload.delta);
    });
    return () => { container.removeEventListener("wheel", wheel, true); unsubscribe(); };
  }, [frameDocumentKey]);
  const [moving, setMoving] = useState(false);
  const [showSceneTools, setShowSceneTools] = useState(false);
  const [showChartTools, setShowChartTools] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const slideByFileRef = useRef(new Map<string, number | null>());
  // Page scroll survives a reload of the same file (each live-preview version) like the slide index does.
  const scrollByFileRef = useRef(new Map<string, FrameScrollPosition>());
  const lastFrameSlideRef = useRef<number | null>(null);
  const restoreTargetSlideIdxRef = useRef<number | null>(null);
  const restoringSlideRef = useRef(false);
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);
  // Surfaces fetch failures inline instead of falling back to the
  // placeholder with no signal (audit fix #6). Cleared on every src
  // change so a successful Refresh recovers cleanly.
  const [loadError, setLoadError] = useState<{ status?: number } | null>(null);
  // Diagnosis of the current render's report attempt, not user-facing copy:
  // a missing report, an unusable answer and a refused report look identical
  // from outside otherwise.
  const [previewReportState, setPreviewReportState] = useState<PreviewReportState | null>(null);
  const previewReportUrl = livePreview?.reportUrl;
  const previewVersion = livePreview?.version;

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !src || iframe.dataset.documentKey !== frameDocumentKey) return;
    let current = true;
    const unsubscribe = subscribeFrameEvent(iframe, "document-loaded", (payload) => {
      // A retained srcdoc can finish loading after the next fetch starts.
      if (payload?.documentKey !== frameLoadKey) return;
      setLoadedFrameKey(frameKey ?? src);
      if (previewReportUrl && previewVersion !== undefined) {
        void requestFramePreviewReport(iframe).then(async (payload) => {
          if (!current) return;
          const report = parseFramePreviewReport(payload);
          // Only this document's own measurements are reported, and only under
          // the version it was loaded for; an unusable answer is recorded as
          // unavailable rather than repaired into an observation.
          if (report === null) { setPreviewReportState("unavailable"); return; }
          const response = await authorizedFetch(previewReportUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...report, version: previewVersion }) });
          if (!current) return;
          setPreviewReportState(response.ok ? "accepted" : `refused_${response.status}`);
        }).catch(() => { if (current) setPreviewReportState("failed"); });
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [frameDocumentKey, frameKey, frameLoadKey, src, previewReportUrl, previewVersion]);

  useEffect(() => {
    restoreTargetSlideIdxRef.current = src ? slideByFileRef.current.get(src) ?? null : null;
    restoringSlideRef.current = restoreTargetSlideIdxRef.current != null;
    lastFrameSlideRef.current = null;
    onActiveSlideChange(null);
  }, [frameKey, src, onActiveSlideChange]);

  useEffect(() => {
    setLoadedFrameKey(null);
    setPreviewReportState(null);
    if (!src) {
      setFrameDocument(null);
      setLoadError(null);
      return;
    }

    const controller = new AbortController();
    const signal = anySignal([controller.signal, AbortSignal.timeout(30_000)]);
    setLoadError(null);
    // The outgoing document is still mounted: remember where the user was before the swap.
    if (frameDocument !== null && frameDocument.src === src && iframeRef.current?.dataset.documentKey === frameDocument.key) {
      void requestFrameScrollPosition(iframeRef.current).then((position) => { if (position !== null) scrollByFileRef.current.set(src, position); });
    }

    void authorizedFetch(src, { signal, cache: "no-store", redirect: "error" })
      .then(async (response) => {
        if (!response.ok) {
          throw Object.assign(
            new Error("artifact_load_failed"),
            { httpStatus: response.status },
          );
        }
        return response.text();
      })
      .then((html) => embedCanvasImages(html, new URL(src, window.location.href).href, signal))
      .then(hydrateCanvasCharts)
      .then((html) => {
        if (controller.signal.aborted) return;
        setFrameDocument({
          key: frameLoadKey,
          src,
          html: buildSandboxedArtifactSrcDoc(
            html,
            new URL(src, window.location.href).toString(),
            { ...(graphicCanvas == null ? {} : { graphicCanvas }), quickCommentKey: frameLoadKey },
          ),
        });
      })
      .catch((err: Error & { httpStatus?: number }) => {
        if (controller.signal.aborted) return;
        setLoadError({ status: err.httpStatus });
      });

    return () => {
      controller.abort();
    };
    // frameDocument is read for the outgoing document only; it must not restart the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameLoadKey, graphicCanvas, src]);

  useEffect(() => {
    if (!src || loadedFrameKey !== (frameKey ?? src)) return;
    const position = scrollByFileRef.current.get(src);
    if (position === undefined) return;
    void requestFrameSetScrollPosition(iframeRef.current, position);
  }, [frameKey, loadedFrameKey, src]);

  useLayoutEffect(() => {
    // Push-based: deck-stage's BRIDGE_SCRIPT broadcasts active-slide-
    // changed on every hashchange / data-active mutation, so we no
    // longer poll at 5 Hz forever (audit fix #1+#3 — that polling kept
    // burning CPU even on idle decks and even when src was null).
    const iframe = iframeRef.current;
    if (!iframe || !src || iframe.dataset.documentKey !== frameDocumentKey) return;
    const unsubscribe = subscribeFrameEvent(
      iframe,
      "active-slide-changed",
      (payload) => {
        // -1 means the artifact has no [data-slide] elements (e.g. a
        // prototype). Surface that as null so the panel hides slide UI.
        const next = payload.index >= 0 ? payload.index : null;
        lastFrameSlideRef.current = next;
        if (restoringSlideRef.current) return;
        slideByFileRef.current.set(src, next);
        onActiveSlideChange(next);
      },
    );
    return unsubscribe;
  }, [frameDocumentKey, onActiveSlideChange, src]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (iframe?.dataset.documentKey !== frameDocumentKey) return;
    return subscribeFrameEvent(iframe, "navigate", (payload: unknown) => {
      if (payload === null || typeof payload !== "object" || !("href" in payload) || typeof payload.href !== "string") return;
      onNavigate?.(payload.href);
    });
  }, [frameDocumentKey, onNavigate]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (iframe?.dataset.documentKey !== frameDocumentKey) return;
    return subscribeFrameEvent(iframe, "navigate-external", openFrameExternalLink);
  }, [frameDocumentKey]);

  useEffect(() => {
    const restoreIdx = restoreTargetSlideIdxRef.current;
    if (!src || loadedFrameKey !== (frameKey ?? src) || restoreIdx == null) {
      return;
    }

    let cancelled = false;
    void requestFrameSetActiveSlide(iframeRef.current, restoreIdx).then((index) => {
      if (cancelled) return;
      const next = index === null ? lastFrameSlideRef.current : index >= 0 ? index : null;
      restoringSlideRef.current = false;
      restoreTargetSlideIdxRef.current = null;
      slideByFileRef.current.set(src, next);
      onActiveSlideChange(next);
    });
    return () => {
      cancelled = true;
    };
  }, [frameKey, loadedFrameKey, src, onActiveSlideChange]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40 max-[900px]:min-h-48">
      <CanvasTopBar
        devicePreset={projectType !== undefined && surfaceForProjectType(projectType) === "website" ? devicePreset : undefined}
        onDevicePresetChange={setDevicePreset}
        mode={mode}
        readOnly={Boolean(livePreview)}
        onModeChange={onModeChange}
        onRefresh={onRefresh}
        canUndo={canUndo}
        undoPending={undoPending}
        onUndo={onUndo}
        colorPalette={colorPalette}
        historyTools={historyTools}
      />
      {livePreview && <div role="status" className="border-b border-border bg-accent/10 px-3 py-1 text-xs text-accent">{t("workspace.canvas.livePreview")}</div>}
      <div ref={containerRef} className="relative flex-1 overflow-auto bg-muted/70">
        <div ref={stageRef} className="absolute inset-3 rounded-md shadow-md ring-1 ring-border/60 max-[600px]:inset-2" style={{ width: deviceWidth, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center" }}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey || !mode || moving || !stageRef.current) return;
            const [x, y] = canvasPoint(stageRef.current, event.clientX, event.clientY);
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageRef.current.clientHeight : 1;
            void requestFrameScrollAtPoint(iframeRef.current, x, y, event.deltaX * unit / zoom, event.deltaY * unit / zoom);
          }}>
        {src ? (
          <iframe
            ref={iframeRef}
            key={frameDocumentKey}
            data-document-key={frameDocumentKey}
            data-preview-report-state={previewReportState ?? undefined}
            aria-busy={loadedFrameKey !== (frameKey ?? src)}
            title={t("workspace.canvas.title")}
            srcDoc={frameSrcDoc ?? placeholderSrc}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full rounded-md border-0 bg-background"
          />
        ) : (
          <iframe
            ref={iframeRef}
            data-document-key={frameDocumentKey}
            title={t("workspace.canvas.placeholderFrameTitle")}
            srcDoc={placeholderSrc}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full rounded-md border-0 bg-background"
          />
        )}
        {src && canvasRenderingVisible({ hasDocument: frameSrcDoc !== null && !livePreview, painted: loadedFrameKey === (frameKey ?? src), failed: loadError !== null }) && (
          <div data-bg-canvas-rendering="" role="status" className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-background">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" aria-hidden="true" />{t("workspace.canvas.renderingTitle")}</div>
          </div>
        )}
        <CommentLayer
          active={mode === "comment"}
          comments={comments}
          activeRelPath={activeRelPath}
          activeSlideIdx={activeSlideIdx}
          iframeRef={iframeRef}
          focusedId={focusedCommentId}
          onCreate={onCreateComment}
          onFocus={onFocusComment}
          onOpen={(comment, point) => setSelectedComment({ documentKey: frameLoadKey, comment, point })}
          documentKey={loadedFrameKey === (frameKey ?? src) ? frameLoadKey : null}
        />
        <EditLayer
          active={mode === "edit"}
          iframeRef={iframeRef}
          selectedBgId={mode === "edit" ? editSelectedBgId : null}
          requestKey={loadedFrameKey}
          onSelect={onSelectEditTarget}
        />
        <TweaksLayer
          active={mode === "tweaks"}
          iframeRef={iframeRef}
          selectedBgId={mode === "tweaks" ? tweaksSelectedBgId : null}
          target={tweaksTarget}
          saving={tweaksSaving}
          onApply={onApplyTweak}
          onSelect={onSelectTweaksTarget}
        />
        {mode === "quality" && <QualityLayer
          active={loadedFrameKey === (frameKey ?? src ?? null)}
          iframeRef={iframeRef}
          nodeBgId={qualityFocusedNodeId}
          requestKey={loadedFrameKey ?? "not-loaded"}
          onRevealResult={onQualityRevealResult}
        />}
        {graphicCanvas != null && (
          <GraphicFrameNavigator
            iframeRef={iframeRef}
            requestKey={loadedFrameKey}
            onFrameChange={onActiveSlideChange}
          />
        )}
        <DrawLayer
          ref={drawLayerRef}
          active={mode === "draw" && !drawLoading && !drawError}
          tool={drawTool}
          color={drawColor}
          strokeWidth={drawStrokeWidth}
          initialShapes={drawInitialShapes}
          resetKey={drawResetKey}
          onCommit={onCommitDraws}
          onHistoryChange={onDrawHistoryChange}
        />
        {mode === "draw" && (drawLoading || drawError) && (
          <div className="absolute inset-0 grid place-items-center bg-background/80">
            <div role={drawError ? "alert" : "status"} className="rounded border border-border bg-background p-4 text-xs">
              {drawError ?? t("workspace.canvas.drawLoading")}
              {drawError && onRetryDraws && (
                <button type="button" onClick={onRetryDraws} className="ml-3 underline">{t("workspace.canvas.retry")}</button>
              )}
            </div>
          </div>
        )}
        {loadError && !(livePreview && frameSrcDoc) && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/80 backdrop-blur-sm">
            <div className="pointer-events-auto max-w-sm rounded border border-destructive/40 bg-background px-4 py-3 text-xs shadow-md">
              <div className="font-semibold text-destructive">
                {t("workspace.canvas.loadFailed")}
                {loadError.status ? ` (HTTP ${loadError.status})` : ""}
              </div>
              <div className="mt-1 text-muted-foreground">
                {t(canvasLoadErrorKey(loadError.status))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  onRefresh();
                }}
                className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
              >
                {t("workspace.canvas.retry")}
              </button>
            </div>
          </div>
        )}
        </div>
        {moving && <div className="absolute inset-0 touch-none" style={{ cursor: "grab" }}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; }}
          onPointerMove={(event) => { const drag = dragRef.current; if (drag) setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }); }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          onLostPointerCapture={() => { dragRef.current = null; }}
        />}
      </div>
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-3 py-1 text-xs" role="group" aria-label={t("workspace.canvas.viewportControls")}>
        <span className="min-w-0 truncate text-xs text-muted-foreground max-[600px]:hidden">{moving ? t("workspace.canvas.dragToPan") : activeRelPath ?? t("workspace.canvas.title")}</span>
        <div className="flex shrink-0 items-center gap-1 max-[600px]:mx-auto">
          <Tooltip content={t("workspace.canvas.zoomOut")}><button type="button" className={VIEWPORT_ICON_BUTTON} aria-label={t("workspace.canvas.zoomOut")} disabled={zoom <= MIN_CANVAS_ZOOM} onClick={() => setZoom((v) => Math.max(MIN_CANVAS_ZOOM, v / 1.25))}><Minus className="h-4 w-4" aria-hidden="true" /></button></Tooltip>
          <Tooltip content={t("workspace.canvas.resetViewportTitle")}><button type="button" className={cn(VIEWPORT_BUTTON, "min-w-12 tabular-nums")} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{t("workspace.canvas.resetViewport")}</button></Tooltip>
          <label className="flex items-center gap-1 max-[600px]:hidden"><input aria-label={t("workspace.canvas.zoomRatio")} type="number" min="1" max="6400" value={Math.round(zoom * 100)} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setZoom(Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, value / 100))); }} className="h-8 w-20 rounded-control border border-input bg-card px-2 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />%</label>
          <Tooltip content={t("workspace.canvas.zoomIn")}><button type="button" className={VIEWPORT_ICON_BUTTON} aria-label={t("workspace.canvas.zoomIn")} disabled={zoom >= MAX_CANVAS_ZOOM} onClick={() => setZoom((v) => Math.min(MAX_CANVAS_ZOOM, v * 1.25))}><Plus className="h-4 w-4" aria-hidden="true" /></button></Tooltip>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border max-[600px]:hidden" />
          <Tooltip content={t("workspace.canvas.dragToPan")} className="max-[600px]:hidden"><button type="button" aria-pressed={moving} className={cn(VIEWPORT_BUTTON, "gap-1.5 max-[600px]:hidden", moving && "bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent")} onClick={() => setMoving((v) => !v)}><Hand className="h-4 w-4" aria-hidden="true" />{t("workspace.canvas.pan")}</button></Tooltip>
          <Tooltip content={t("workspace.canvas.zoomHint")} className="max-[600px]:hidden"><button type="button" className={cn(VIEWPORT_ICON_BUTTON, "max-[600px]:hidden")} aria-label={t("workspace.canvas.zoomHelp")}><Info className="h-4 w-4" aria-hidden="true" /></button></Tooltip>
          {sceneTools && <Tooltip content={t("workspace.canvas.scene3d")}><button type="button" aria-pressed={showSceneTools} aria-label={t("workspace.canvas.scene3d")} className={cn(VIEWPORT_BUTTON, "gap-1.5", showSceneTools && "bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent")} onClick={() => setShowSceneTools((value) => !value)}><Box className="h-4 w-4" aria-hidden="true" /><span className="max-[600px]:hidden">{t("workspace.canvas.scene3d")}</span></button></Tooltip>}
          {chartTools && <Tooltip content={t("workspace.canvas.chart")}><button type="button" aria-pressed={showChartTools} aria-label={t("workspace.canvas.chart")} className={cn(VIEWPORT_BUTTON, "gap-1.5", showChartTools && "bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent")} onClick={() => { setShowChartTools(value => !value); setShowSceneTools(false); }}><BarChart3 className="h-4 w-4" aria-hidden="true" /><span className="max-[600px]:hidden">{t("workspace.canvas.chart")}</span></button></Tooltip>}
        </div>
      </div>
      {!livePreview && !loadError && activeRelPath && frameDocument?.key === frameLoadKey && loadedFrameKey === (frameKey ?? src) && (
        <QuickComment
          key={JSON.stringify([frameLoadKey, activeRelPath, activeSlideIdx])}
          iframeRef={iframeRef}
          containerRef={containerRef}
          documentKey={frameLoadKey}
          comments={comments}
          onCreate={onQuickCreateComment}
          renderComment={renderQuickComment}
          selected={selectedComment}
        />
      )}
      {showSceneTools && sceneTools}
      {showChartTools && chartTools}
    </div>
  );
}
