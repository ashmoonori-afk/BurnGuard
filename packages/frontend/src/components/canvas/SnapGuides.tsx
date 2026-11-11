import { useT } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { snapGuideChip } from "@/lib/snap-guides";
import type { SnapGuide, SnapRect } from "@/lib/snap-engine";

const CHIP = "absolute whitespace-nowrap rounded-sm bg-accent px-1 font-mono text-[11px] leading-4 text-accent-foreground";
type Anchor = "above" | "before" | "below" | "after";
const ANCHORS: Record<Anchor, { shift: string; origin: string }> = {
  above: { shift: "translate(-50%, -100%)", origin: "50% 100%" },
  before: { shift: "translate(-100%, -50%)", origin: "100% 50%" },
  below: { shift: "translate(-50%, 0)", origin: "50% 0" },
  after: { shift: "translate(0, -50%)", origin: "0 50%" },
};

/**
 * Magnet guides over the canvas: a one-screen-pixel line for each lock with a named chip beside the box being moved
 * or resized (`box`), both gaps of an equal spacing, a badge naming the sibling whose size is matched, and the angle
 * a rotation locked to. Parent chrome only, so nothing reaches the artifact or an export. The Style panel says the
 * same in words, which is why this layer is hidden from assistive technology.
 */
export default function SnapGuides({ guides, box, names, zoom, live, onFaded }: { guides: readonly SnapGuide[]; box: SnapRect; names: ReadonlyMap<string, string>; zoom: number; live: boolean; onFaded: () => void }) {
  const t = useT();
  if (guides.length === 0) return null;
  const stroke = 1 / zoom;
  // Far enough from the box to clear the resize handles, which may sit outside a small box.
  const clearance = 24 * stroke;
  const chip = (text: string, left: number, top: number, anchor: Anchor) => (
    <span className={CHIP} style={{ left, top, transform: `${ANCHORS[anchor].shift} scale(${stroke})`, transformOrigin: ANCHORS[anchor].origin }}>{text}</span>
  );
  return (
    <div aria-hidden="true" onTransitionEnd={onFaded} className={cn("pointer-events-none absolute inset-0 transition-opacity duration-100 ease-out motion-reduce:transition-none", !live && "opacity-0")}>
      {guides.map((guide, index) => {
        const label = snapGuideChip(guide, names);
        const text = t(label.key, label.params);
        if (guide.kind === "angle") return <div key={index} data-snap-guide={label.key}>{chip(text, box.left + box.width / 2, box.top - 36 * stroke, "above")}</div>;
        const vertical = guide.axis === "x";
        if (guide.kind === "size") {
          return <div key={index} data-snap-guide={label.key}>{vertical ? chip(text, box.left + box.width / 2, box.top + box.height + clearance, "below") : chip(text, box.left + box.width + clearance, box.top + box.height / 2, "after")}</div>;
        }
        if (guide.kind === "line") {
          return (
            <div key={index} data-snap-guide={label.key}>
              <div className="absolute bg-accent" style={vertical ? { left: guide.position - stroke / 2, top: guide.from, width: stroke, height: guide.to - guide.from } : { left: guide.from, top: guide.position - stroke / 2, width: guide.to - guide.from, height: stroke }} />
              {vertical ? chip(text, guide.position, box.top, "above") : chip(text, box.left, guide.position, "before")}
            </div>
          );
        }
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
      })}
    </div>
  );
}
