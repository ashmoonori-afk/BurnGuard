import { useEffect, useRef, useState } from "react";
import type { Comment, GraphicCanvasV1 } from "@bg/shared";
import CanvasTopBar from "./CanvasTopBar";
import CommentLayer from "./CommentLayer";
import type { Ref, ReactNode } from "react";
import DrawLayer, {
  type DrawLayerHandle,
  type DrawShape,
  type DrawTool,
} from "./DrawLayer";
import EditLayer, { type EditTarget } from "./EditLayer";
import TweaksLayer, { type TweaksStyleKey, type TweaksTarget } from "./TweaksLayer";
import QualityLayer from "./QualityLayer";
import {
  buildSandboxedArtifactSrcDoc,
  requestFrameSetActiveSlide,
  subscribeFrameEvent,
} from "./frame-bridge";
import type { CanvasMode } from "@/components/modes/types";
import { authorizedFetch } from "@/api/client";
import { embedCanvasImages } from "@/lib/canvas-images";
import { canvasPoint } from "./canvas-coordinates";
import { requestFrameScrollAtPoint } from "./frame-bridge";

const PLACEHOLDER_SRC = `<!doctype html>
<html lang="ko">
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
    <h1 class="title">아직 표시할 결과물이 없어요</h1>
    <p class="subtitle">왼쪽 채팅에 만들고 싶은 것을 적어 보내면, 생성된 파일이 이 자리에 바로 나타나요.</p>
  </section>
</body>
</html>`;

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
  colorPalette,
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
  colorPalette?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  const [showSceneTools, setShowSceneTools] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const slideByFileRef = useRef(new Map<string, number | null>());
  const lastFrameSlideRef = useRef<number | null>(null);
  const restoreTargetSlideIdxRef = useRef<number | null>(null);
  const restoringSlideRef = useRef(false);
  const frameLoadKey = JSON.stringify([src, frameKey]);
  const [frameDocument, setFrameDocument] = useState<{ key: string; html: string } | null>(null);
  const frameSrcDoc = frameDocument?.key === frameLoadKey ? frameDocument.html : null;
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);
  // Surfaces fetch failures inline instead of falling back to the
  // placeholder with no signal (audit fix #6). Cleared on every src
  // change so a successful Refresh recovers cleanly.
  const [loadError, setLoadError] = useState<{
    status?: number;
    message: string;
  } | null>(null);

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
    setFrameDocument(null);
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
      .then((html) => {
        if (controller.signal.aborted) return;
        setFrameDocument({
          key: frameLoadKey,
          html: buildSandboxedArtifactSrcDoc(
            html,
            new URL(src, window.location.href).toString(),
            graphicCanvas === null || graphicCanvas === undefined
              ? undefined
              : { graphicCanvas },
          ),
        });
      })
      .catch((err: Error & { httpStatus?: number }) => {
        if (controller.signal.aborted) return;
        setFrameDocument(null);
        setLoadError({
          status: err.httpStatus,
          message: err.httpStatus === 404
            ? "파일을 찾을 수 없어요. 파일 목록을 새로고침한 뒤 다시 선택해 주세요."
            : err.httpStatus === 401 || err.httpStatus === 403
              ? "페이지를 새로고침한 뒤 다시 시도해 주세요."
              : "서버 연결과 파일 상태를 확인한 뒤 다시 시도해 주세요.",
        });
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
        onModeChange={onModeChange}
        onRefresh={onRefresh}
        canUndo={canUndo}
        undoPending={undoPending}
        onUndo={onUndo}
        colorPalette={colorPalette}
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-xs" aria-label="미리보기 배율과 이동">
        <button type="button" aria-label="미리보기 축소" disabled={zoom <= 0.25} onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}>−</button>
        <button type="button" title="배율과 위치 초기화" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="미리보기 확대" disabled={zoom >= 3} onClick={() => setZoom((v) => Math.min(3, v + 0.25))}>+</button>
        <button type="button" aria-pressed={moving} className="rounded border border-border px-2 py-1" onClick={() => setMoving((v) => !v)}>화면 이동</button>
        {moving && <span className="text-muted-foreground">드래그해서 이동해요</span>}
        {sceneTools && <button type="button" aria-pressed={showSceneTools} className="rounded border border-border px-2 py-1" onClick={() => setShowSceneTools((value) => !value)}>3D 장면</button>}
      </div>
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <div ref={stageRef} className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center" }}
          onWheel={(event) => {
            if (!mode || moving || !stageRef.current) return;
            const [x, y] = canvasPoint(stageRef.current, event.clientX, event.clientY);
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageRef.current.clientHeight : 1;
            void requestFrameScrollAtPoint(iframeRef.current, x, y, event.deltaX * unit / zoom, event.deltaY * unit / zoom);
          }}>
        {src ? (
          <iframe
            ref={iframeRef}
            key={frameKey}
            title="캔버스"
            srcDoc={frameSrcDoc ?? PLACEHOLDER_SRC}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
            onLoad={() => {
              if (frameSrcDoc !== null) setLoadedFrameKey(frameKey ?? src);
            }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            title="캔버스 자리 표시자"
            srcDoc={PLACEHOLDER_SRC}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
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
              {drawError ?? "저장된 그리기를 불러오고 있어요."}
              {drawError && onRetryDraws && (
                <button type="button" onClick={onRetryDraws} className="ml-3 underline">다시 시도</button>
              )}
            </div>
          </div>
        )}
        {loadError && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/80 backdrop-blur-sm">
            <div className="pointer-events-auto max-w-sm rounded border border-destructive/40 bg-background px-4 py-3 text-xs shadow-md">
              <div className="font-semibold text-destructive">
                결과물을 불러오지 못했어요
                {loadError.status ? ` (HTTP ${loadError.status})` : ""}
              </div>
              <div className="mt-1 text-muted-foreground">
                {loadError.message}
              </div>
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  onRefresh();
                }}
                className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted"
              >
                다시 시도
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
      {showSceneTools && sceneTools}
    </div>
  );
}
