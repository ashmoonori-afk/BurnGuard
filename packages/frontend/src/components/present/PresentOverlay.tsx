import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Fullscreen deck playback overlay. Mounts a second iframe fed through
 * the backend `/fs/` route with `?present=1` — deck-stage picks that up
 * and sets `body[data-presenter]`, which the slide-deck template uses
 * to reveal speaker notes.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

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
      if (e.key === "Escape") {
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
      aria-label="프레젠테이션"
    >
      <iframe
        key={src}
        ref={iframeRef}
        title="프레젠테이션"
        src={withPresentFlag(src)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={() => iframeRef.current?.focus()}
        className="absolute inset-0 h-full w-full border-0 bg-black"
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
        title="프레젠테이션 종료 (Esc)"
      >
        <X className="h-3 w-3" /> 종료
      </button>
      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] text-white backdrop-blur">
        {formatElapsed(elapsedMs)}
      </div>
    </div>
  );
}

function withPresentFlag(src: string): string {
  if (src.includes("present=")) return src;
  return src.includes("?") ? `${src}&present=1` : `${src}?present=1`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
