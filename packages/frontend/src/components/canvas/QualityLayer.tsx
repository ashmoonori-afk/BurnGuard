import { useEffect, useState, type RefObject } from "react";
import { requestFrameRectForBgId, type FrameRect } from "./frame-bridge";

/** The bridge answers a rect for any existing node; a hidden slide yields a zero-area box, which is not a reveal. */
export function revealOutcome(rect: FrameRect | null): boolean {
  return rect !== null && rect.width > 0 && rect.height > 0;
}

export default function QualityLayer({ active, iframeRef, nodeBgId, requestKey, onRevealResult }: {
  readonly active: boolean;
  readonly iframeRef: RefObject<HTMLIFrameElement | null>;
  readonly nodeBgId: string | null;
  readonly requestKey: string;
  readonly onRevealResult: (nodeBgId: string, found: boolean) => void;
}) {
  const [rect, setRect] = useState<FrameRect | null>(null);
  useEffect(() => {
    if (!active || nodeBgId === null) { setRect(null); return; }
    let mounted = true;
    void requestFrameRectForBgId(iframeRef.current, nodeBgId).then((next) => {
      if (!mounted) return;
      const found = revealOutcome(next);
      setRect(found ? next : null);
      onRevealResult(nodeBgId, found);
    });
    return () => { mounted = false; };
  }, [active, iframeRef, nodeBgId, onRevealResult, requestKey]);
  if (!active || rect === null) return null;
  return <div aria-hidden="true" className="pointer-events-none absolute border-2 border-accent bg-accent/10" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />;
}
