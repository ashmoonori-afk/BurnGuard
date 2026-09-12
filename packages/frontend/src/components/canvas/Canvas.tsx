import { useEffect, useRef, useState } from "react";
import type { Comment, GraphicCanvasV1 } from "@bg/shared";
import CanvasTopBar from "./CanvasTopBar";
import CommentLayer from "./CommentLayer";
import QuickComment from "./QuickComment";
import type { CommentPinInput } from "./quick-comment";
import type { Ref, ReactNode } from "react";
import DrawLayer, {
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
  requestFrameSetActiveSlide,
  requestFramePreviewReport,
  subscribeFrameEvent,
} from "./frame-bridge";
import type { CanvasMode } from "@/components/modes/types";
import { authorizedFetch } from "@/api/client";
import { embedCanvasImages } from "@/lib/canvas-images";
import { hydrateCanvasCharts } from "@/lib/canvas-charts";
import { canvasPoint } from "./canvas-coordinates";
import { requestFrameScrollAtPoint } from "./frame-bridge";

import { MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM, zoomCanvasAt } from "./canvas-zoom";
import { useT } from "@/i18n/t";
import { useLocaleStore } from "@/i18n/locale";

function buildPlaceholderSrc(locale: string, title: string, subtitle: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      background: #f1f3f5;
      color: #17191a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif;
      display: grid;
      place-items: center;
      min-height: 100vh;
      word-break: keep-all;
    }
    .wrap { text-align: center; padding: 48px; max-width: 480px; }
    .eyebrow {
      color: #004fff;
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    .title { font-size: 22px; font-weight: 700; margin: 0; }
    .subtitle {
      color: #5e646c;
      font-size: 14px;
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

export default function Canvas({
  mode,
  src,
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
  mode: CanvasMode | null;
  src?: string | null;
  frameKey?: string;
  onModeChange: (m: CanvasMode | null) => void;
  onRefresh: () => void;
  onNavigate?: (href: string) => void;
  comments: Comment[];
  activeRelPath: string | null;
  activeSlideIdx: number | null;
  focusedCommentId: string | null;
  onCreateComment: (input: {
    x_pct: number;
    y_pct: number;
    node_selector: string;
    slide_index: number | null;
  }) => void;
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
  const placeholderSrc = buildPlaceholderSrc(
    locale,
    t("workspace.canvas.placeholderTitle"),
    t("workspace.canvas.placeholderSubtitle"),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef({ zoom, pan });
  viewportRef.current = { zoom, pan };
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
  }, [frameKey, src]);
  const [moving, setMoving] = useState(false);
  const [showSceneTools, setShowSceneTools] = useState(false);
  const [showChartTools, setShowChartTools] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const slideByFileRef = useRef(new Map<string, number | null>());
  const lastFrameSlideRef = useRef<number | null>(null);
  const restoreTargetSlideIdxRef = useRef<number | null>(null);
  const restoringSlideRef = useRef(false);
  const frameLoadKey = JSON.stringify([src, frameKey]);
  const [frameDocument, setFrameDocument] = useState<{ key: string; src: string; html: string } | null>(null);
  // Keep the previous render visible while its next version and assets load.
  const frameSrcDoc = frameDocument && frameDocument.src === src ? frameDocument.html : null;
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);
  // Surfaces fetch failures inline instead of falling back to the
  // placeholder with no signal (audit fix #6). Cleared on every src
  // change so a successful Refresh recovers cleanly.
  const [loadError, setLoadError] = useState<{ status?: number } | null>(null);

  useEffect(() => {
    restoreTargetSlideIdxRef.current = src ? slideByFileRef.current.get(src) ?? null : null;
    restoringSlideRef.current = restoreTargetSlideIdxRef.current != null;
    lastFrameSlideRef.current = null;
    onActiveSlideChange(null);
  }, [frameKey, src, onActiveSlideChange]);

  useEffect(() => {
    setLoadedFrameKey(null);
    if (!src) {
      setFrameDocument(null);
      setLoadError(null);
      return;
    }

    const controller = new AbortController();
    setLoadError(null);

    void authorizedFetch(src, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw Object.assign(
            new Error("artifact_load_failed"),
            { httpStatus: response.status },
          );
        }
        return response.text();
      })
      .then((html) => embedCanvasImages(html, new URL(src, window.location.href).href, controller.signal))
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
  }, [frameLoadKey, graphicCanvas, src]);

  useEffect(() => {
    // Push-based: deck-stage's BRIDGE_SCRIPT broadcasts active-slide-
    // changed on every hashchange / data-active mutation, so we no
    // longer poll at 5 Hz forever (audit fix #1+#3 — that polling kept
    // burning CPU even on idle decks and even when src was null).
    const iframe = iframeRef.current;
    if (!iframe || !src) return;
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
  }, [frameKey, onActiveSlideChange, src]);

  useEffect(() => {
    return subscribeFrameEvent(iframeRef.current, "navigate", (payload: unknown) => {
      if (payload === null || typeof payload !== "object" || !("href" in payload) || typeof payload.href !== "string") return;
      onNavigate?.(payload.href);
    });
  }, [frameKey, src, onNavigate]);

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
      <div ref={containerRef} className="relative flex-1 overflow-hidden bg-muted/70">
        <div ref={stageRef} className="absolute inset-3 rounded-md shadow-md ring-1 ring-border/60 max-[600px]:inset-2" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center" }}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey || !mode || moving || !stageRef.current) return;
            const [x, y] = canvasPoint(stageRef.current, event.clientX, event.clientY);
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageRef.current.clientHeight : 1;
            void requestFrameScrollAtPoint(iframeRef.current, x, y, event.deltaX * unit / zoom, event.deltaY * unit / zoom);
          }}>
        {src ? (
          <iframe
            ref={iframeRef}
            key={src}
            title={t("workspace.canvas.title")}
            srcDoc={frameSrcDoc ?? placeholderSrc}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full rounded-md border-0 bg-background"
            onLoad={() => {
              if (frameSrcDoc !== null) setLoadedFrameKey(frameKey ?? src);
              if (livePreview && frameDocument?.key === frameLoadKey) {
                void requestFramePreviewReport(iframeRef.current).then(async (report) => {
                  if (!report || typeof report !== "object" || Array.isArray(report)) return;
                  await authorizedFetch(livePreview.reportUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...report, version: livePreview.version }) });
                }).catch(() => {});
              }
            }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            title={t("workspace.canvas.placeholderFrameTitle")}
            srcDoc={placeholderSrc}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full rounded-md border-0 bg-background"
          />
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
        />
        <EditLayer
          active={mode === "edit"}
          iframeRef={iframeRef}
          selectedBgId={mode === "edit" ? editSelectedBgId : null}
          requestKey={loadedFrameKey}
          onSelect={onSelectEditTarget}
        />
        <TweaksLayer
          active={mode === "tweaks" || mode === "select"}
          iframeRef={iframeRef}
          selectedBgId={mode === "tweaks" || mode === "select" ? tweaksSelectedBgId : null}
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
                {t(loadError.status === 404
                  ? "workspace.canvas.fileNotFound"
                  : loadError.status === 401 || loadError.status === 403
                    ? "workspace.canvas.unauthorized"
                    : "workspace.canvas.connectionError")}
              </div>
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  onRefresh();
                }}
                className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted"
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-3 py-1 text-xs" aria-label={t("workspace.canvas.viewportControls")}>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{moving ? t("workspace.canvas.dragToPan") : activeRelPath ?? t("workspace.canvas.title")}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="h-8 w-8 rounded hover:bg-muted disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("workspace.canvas.zoomOut")} disabled={zoom <= MIN_CANVAS_ZOOM} onClick={() => setZoom((v) => Math.max(MIN_CANVAS_ZOOM, v / 1.25))}>−</button>
          <button type="button" className="h-8 min-w-12 rounded px-1 tabular-nums hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" title={t("workspace.canvas.resetViewportTitle")} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{t("workspace.canvas.resetViewport")}</button>
          <label className="flex items-center gap-1"><input aria-label={t("workspace.canvas.zoomRatio")} type="number" min="1" max="6400" value={Math.round(zoom * 100)} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setZoom(Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, value / 100))); }} className="h-8 w-20 rounded border bg-background px-2 tabular-nums" />%</label>
          <button type="button" className="h-8 w-8 rounded hover:bg-muted disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("workspace.canvas.zoomIn")} disabled={zoom >= MAX_CANVAS_ZOOM} onClick={() => setZoom((v) => Math.min(MAX_CANVAS_ZOOM, v * 1.25))}>+</button>
          <button type="button" aria-pressed={moving} className={`ml-1 h-8 rounded-md px-2 focus-visible:ring-2 focus-visible:ring-ring ${moving ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted"}`} onClick={() => setMoving((v) => !v)}>{t("workspace.canvas.pan")}</button><span className="text-muted-foreground">{t("workspace.canvas.zoomHint")}</span>
          {sceneTools && <button type="button" aria-pressed={showSceneTools} className={`h-8 rounded-md px-2 focus-visible:ring-2 focus-visible:ring-ring ${showSceneTools ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted"}`} onClick={() => setShowSceneTools((value) => !value)}>{t("workspace.canvas.scene3d")}</button>}
          {chartTools && <button type="button" aria-pressed={showChartTools} className={`h-8 rounded-md px-2 focus-visible:ring-2 focus-visible:ring-ring ${showChartTools ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted"}`} onClick={() => { setShowChartTools(value => !value); setShowSceneTools(false); }}>{t("workspace.canvas.chart")}</button>}
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
        />
      )}
      {showSceneTools && sceneTools}
      {showChartTools && chartTools}
    </div>
  );
}
