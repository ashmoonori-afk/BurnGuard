import { useT } from "@/i18n/t";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { authorizedFetch } from "@/api/client";
import { embedCanvasImages } from "@/lib/canvas-images";
import { hydrateCanvasCharts } from "@/lib/canvas-charts";
import { buildSandboxedArtifactSrcDoc, subscribeFrameEvent } from "@/components/canvas/frame-bridge";
import { isCommentEditable } from "@/components/canvas/quick-comment";

/**
 * Fullscreen deck playback in the same opaque srcdoc sandbox as the canvas.
 * The parent acquires project assets with its authority; the frame bridge sets
 * body[data-presenter] to reveal speaker notes without exposing credentials.
 *
 * The overlay requests real browser fullscreen on mount. When the user
 * exits fullscreen (Esc, F11, the x button), the overlay dismounts so
 * the main canvas regains focus.
 */
export default function PresentOverlay({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const presentationKey = useMemo(() => JSON.stringify([src, crypto.randomUUID()]), [src]);
  const [frameDocument, setFrameDocument] = useState<{ key: string; html: string } | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(src, window.location.href);
    url.searchParams.set("present", "1");
    setLoadError(false);
    void authorizedFetch(url.href, { signal: controller.signal, cache: "no-store", redirect: "error" })
      .then(async response => {
        if (!response.ok) throw new Error("artifact_load_failed");
        return response.text();
      })
      .then(html => embedCanvasImages(html, url.href, controller.signal))
      .then(hydrateCanvasCharts)
      .then(html => {
        if (!controller.signal.aborted) setFrameDocument({ key: presentationKey, html: buildSandboxedArtifactSrcDoc(html, url.href, { presentationKey }) });
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [src, presentationKey]);

  useEffect(() => subscribeFrameEvent(iframeRef.current, "present-dismiss", payload => {
    if (payload?.documentKey === presentationKey) onClose();
  }), [presentationKey, onClose]);

  useEffect(() => {
    // Restore focus to whatever had it before the overlay opened once
    // the overlay closes, so keyboard users land back where they were
    // instead of at the top of the document.
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    // Best-effort fullscreen. On Firefox/Safari prefixed APIs exist but
    // the unprefixed one is enough for Electron + modern Chrome/Edge,
    // which is the target. Failure is silent — the overlay still covers
    // the viewport via `position: fixed`.
    node.requestFullscreen?.().catch(() => {
      // ignore — permission prompt rejected or API unsupported
    });
    const started = performance.now();
    const tick = window.setInterval(() => {
      setElapsedMs(performance.now() - started);
    }, 500);
    return () => {
      window.clearInterval(tick);
      if (document.fullscreenElement === node) {
        document.exitFullscreen?.().catch(() => {
          // ignore
        });
      }
    };
  }, []);

  useEffect(() => {
    // When the user exits fullscreen via Esc / F11 / system shortcut,
    // dismiss the overlay so we don't leave them trapped in a dim
    // non-fullscreen version of the same view.
    const onFsChange = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.repeat && !e.isComposing && e.keyCode !== 229 && !e.defaultPrevented && !isCommentEditable(e.target instanceof Element ? e.target : null)) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[9999] bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.present.title")}
    >
      <iframe
        key={src}
        ref={iframeRef}
        title={t("canvas.present.title")}
        srcDoc={frameDocument?.key === presentationKey ? frameDocument.html : ""}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={() => iframeRef.current?.focus()}
        className="absolute inset-0 h-full w-full border-0 bg-black"
      />
      {loadError && <div role="alert" className="absolute inset-0 grid place-items-center text-sm text-white">{t("workspace.canvas.loadFailed")}</div>}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
        title={t("canvas.present.exitHint")}
      >
        <X className="h-3 w-3" /> {" "}{t("canvas.present.exit")}</button>
      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] text-white backdrop-blur">
        {formatElapsed(elapsedMs)}
      </div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
