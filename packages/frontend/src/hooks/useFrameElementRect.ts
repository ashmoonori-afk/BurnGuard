import { useEffect, useState, type RefObject } from "react";
import type { FrameRect } from "@/components/canvas/frame-bridge";

const POLL_INTERVAL_MS = 200;

/**
 * Polls the iframe for the bounding rect of a target element and
 * returns the latest value (or null when none / inactive).
 *
 * Three canvas overlays — SelectorOverlay, EditLayer, TweaksLayer —
 * each used to maintain their own near-identical 200 ms tick loop
 * with subtly different identifier shapes (selector string vs
 * data-bg-node-id). This hook hoists the polling pattern into one
 * place so the diff between overlays stays at the visual layer.
 *
 * The resolver is the per-overlay request function (e.g.
 * requestFrameRectForBgId). Compares incoming rects to the previous
 * one before calling setState so an unchanged rect never re-renders
 * the consumer.
 *
 * Stops the interval when `identifier` is null or `iframeRef.current`
 * is null. Mode-gated overlays should pass `identifier=null` while
 * their mode is inactive.
 */
export function useFrameElementRect<TIdentifier extends string>(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  identifier: TIdentifier | null,
  resolver: (
    iframe: HTMLIFrameElement | null,
    id: TIdentifier,
  ) => Promise<FrameRect | null>,
  requestKey?: unknown,
): FrameRect | null {
  const [rect, setRect] = useState<FrameRect | null>(null);

  useEffect(() => {
    if (!identifier) {
      setRect(null);
      return;
    }
    setRect(null);
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const next = await resolver(iframeRef.current, identifier);
      if (!alive) return;
      setRect((prev) => (rectEqual(prev, next) ? prev : next));
    };
    void tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [identifier, iframeRef, resolver, requestKey]);

  return rect;
}

function rectEqual(a: FrameRect | null, b: FrameRect | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}
