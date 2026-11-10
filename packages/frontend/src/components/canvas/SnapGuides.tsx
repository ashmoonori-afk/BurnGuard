import { useT } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { snapGuideChip } from "@/lib/snap-guides";
import type { SnapGuide } from "@/lib/snap-engine";

const CHIP = "absolute whitespace-nowrap rounded-sm bg-accent px-1 font-mono text-[11px] leading-4 text-accent-foreground";

/**
 * Magnet guides over the canvas: a one-screen-pixel line for each lock with a named chip beside the moved box (`box`
 * is its top-left corner), and both gaps of an equal spacing. Parent chrome only, so nothing reaches the artifact or an export. The Style panel says the same in words,
 * which is why this layer is hidden from assistive technology.
 */
export default function SnapGuides({ guides, box, zoom, live, onFaded }: { guides: readonly SnapGuide[]; box: { left: number; top: number }; zoom: number; live: boolean; onFaded: () => void }) {
  const t = useT();
  if (guides.length === 0) return null;
  const stroke = 1 / zoom;
  const chip = (text: string, left: number, top: number, anchor: "above" | "before") => (
    <span className={CHIP} style={{ left, top, transform: `${anchor === "above" ? "translate(-50%, -100%)" : "translate(-100%, -50%)"} scale(${stroke})`, transformOrigin: anchor === "above" ? "50% 100%" : "100% 50%" }}>{text}</span>
  );
  return (
    <div aria-hidden="true" onTransitionEnd={onFaded} className={cn("pointer-events-none absolute inset-0 transition-opacity duration-100 ease-out motion-reduce:transition-none", !live && "opacity-0")}>
      {guides.map((guide, index) => {
        const label = snapGuideChip(guide);
        const text = t(label.key, label.params);
        const vertical = guide.axis === "x";
        if (guide.kind === "line") {
          return (
            <div key={index} data-snap-guide={label.key}>
              <div className="absolute bg-accent" style={vertical ? { left: guide.position - stroke / 2, top: guide.from, width: stroke, height: guide.to - guide.from } : { left: guide.from, top: guide.position - stroke / 2, width: guide.to - guide.from, height: stroke }} />
              {vertical ? chip(text, guide.position, box.top, "above") : chip(text, box.left, guide.position, "before")}
            </div>
          );
        }
        if (guide.kind === "gap") {
          return (
            <div key={index} data-snap-guide={label.key}>
              {guide.segments.map((segment, part) => (
                <div key={part}>
                  <div className="absolute bg-accent" style={vertical ? { left: segment.from, top: guide.cross - stroke / 2, width: segment.to - segment.from, height: stroke } : { left: guide.cross - stroke / 2, top: segment.from, width: stroke, height: segment.to - segment.from }} />
                  {vertical ? chip(text, (segment.from + segment.to) / 2, guide.cross, "above") : chip(text, guide.cross, (segment.from + segment.to) / 2, "before")}
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
