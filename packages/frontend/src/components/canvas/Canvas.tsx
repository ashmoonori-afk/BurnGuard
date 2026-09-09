import { useEffect, useRef, useState } from "react";
import type { Comment, GraphicCanvasV1 } from "@bg/shared";
import CanvasTopBar from "./CanvasTopBar";
import CommentLayer from "./CommentLayer";
import type { Ref } from "react";
import DrawLayer, {
  type DrawLayerHandle,
  type DrawShape,
  type DrawTool,
} from "./DrawLayer";
import EditLayer, { type EditTarget } from "./EditLayer";
import SelectorOverlay from "./SelectorOverlay";
import TweaksLayer, { type TweaksTarget } from "./TweaksLayer";
import QualityLayer from "./QualityLayer";
import {
  buildSandboxedArtifactSrcDoc,
  requestFrameSetActiveSlide,
  subscribeFrameEvent,
} from "./frame-bridge";
import type { CanvasMode } from "@/components/modes/types";
import type { SelectedNode } from "@/types/project";

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
  onSelect,
  onRefresh,
  comments,
  activeRelPath,
  activeSlideIdx,
  focusedCommentId,
  onCreateComment,
  onFocusComment,
  editSelectedBgId,
  onSelectEditTarget,
  tweaksSelectedBgId,
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
}: {
  mode: CanvasMode | null;
  src?: string | null;
  frameKey?: string;
  onModeChange: (m: CanvasMode | null) => void;
  onSelect: (s: SelectedNode | null) => void;
  onRefresh: () => void;
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastKnownSlideIdxRef = useRef<number | null>(null);
  const restoreTargetSlideIdxRef = useRef<number | null>(null);
  const restoringSlideRef = useRef(false);
  const [frameSrcDoc, setFrameSrcDoc] = useState<string | null>(null);
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);
  // Surfaces fetch failures inline instead of falling back to the
  // placeholder with no signal (audit fix #6). Cleared on every src
  // change so a successful Refresh recovers cleanly.
  const [loadError, setLoadError] = useState<{
    status?: number;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (activeSlideIdx != null) {
      lastKnownSlideIdxRef.current = activeSlideIdx;
    }
  }, [activeSlideIdx]);

  useEffect(() => {
    if (!src) {
      restoreTargetSlideIdxRef.current = null;
      restoringSlideRef.current = false;
      return;
    }
    restoreTargetSlideIdxRef.current = lastKnownSlideIdxRef.current;
    restoringSlideRef.current = restoreTargetSlideIdxRef.current != null;
  }, [frameKey, src]);

  useEffect(() => {
    setLoadedFrameKey(null);
    if (!src) {
      setFrameSrcDoc(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setFrameSrcDoc(null);
    setLoadError(null);

    void fetch(src, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const detail = text.trim().slice(0, 200);
          throw Object.assign(
            new Error(
              detail ||
                `Backend returned HTTP ${response.status} fetching the artifact.`,
            ),
            { httpStatus: response.status },
          );
        }
        return response.text();
      })
      .then((html) => {
        if (cancelled) return;
        setFrameSrcDoc(
          buildSandboxedArtifactSrcDoc(
            html,
            new URL(src, window.location.href).toString(),
            graphicCanvas === null || graphicCanvas === undefined
              ? undefined
              : { graphicCanvas },
          ),
        );
      })
      .catch((err: Error & { httpStatus?: number }) => {
        if (cancelled) return;
        setFrameSrcDoc(null);
        setLoadError({
          status: err.httpStatus,
          message: err.message || "결과물을 불러오지 못했어요.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [frameKey, graphicCanvas, src]);

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
        if (restoringSlideRef.current) {
          const target = restoreTargetSlideIdxRef.current;
          if (target == null || next === target) {
            restoringSlideRef.current = false;
            restoreTargetSlideIdxRef.current = null;
            onActiveSlideChange(next);
          }
          return;
        }
        onActiveSlideChange(next);
      },
    );
    return unsubscribe;
  }, [frameKey, onActiveSlideChange, src]);

  useEffect(() => {
    const restoreIdx = restoreTargetSlideIdxRef.current;
    if (!src || frameSrcDoc === null || restoreIdx == null) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const restore = () => {
      if (cancelled) return;
      attempts += 1;
      void requestFrameSetActiveSlide(iframeRef.current, restoreIdx).then(
        (ok) => {
          if (cancelled || ok || attempts >= 10) return;
          window.setTimeout(restore, 80);
        },
      );
    };

    const timer = window.setTimeout(restore, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [frameKey, frameSrcDoc, src]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40 max-[900px]:min-h-48">
      <CanvasTopBar
        mode={mode}
        onModeChange={onModeChange}
        onRefresh={onRefresh}
        canUndo={canUndo}
        undoPending={undoPending}
        onUndo={onUndo}
      />
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {src ? (
          <iframe
            ref={iframeRef}
            key={frameKey}
            title="캔버스"
            srcDoc={frameSrcDoc ?? PLACEHOLDER_SRC}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
            onLoad={() => setLoadedFrameKey(frameKey ?? src)}
          />
        ) : (
          <iframe
            ref={iframeRef}
            title="캔버스 자리 표시자"
            srcDoc={PLACEHOLDER_SRC}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            allow="fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
          />
        )}
        <SelectorOverlay
          active={mode === "select"}
          iframeRef={iframeRef}
          activeRelPath={activeRelPath}
          onSelect={onSelect}
        />
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
          active={mode === "tweaks"}
          iframeRef={iframeRef}
          selectedBgId={mode === "tweaks" ? tweaksSelectedBgId : null}
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
          active={mode === "draw"}
          tool={drawTool}
          color={drawColor}
          strokeWidth={drawStrokeWidth}
          initialShapes={drawInitialShapes}
          resetKey={drawResetKey}
          onCommit={onCommitDraws}
        />
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
    </div>
  );
}
