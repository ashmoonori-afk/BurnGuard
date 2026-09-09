import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Compass, FileCode, Folder, Palette, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactTab } from "@/types/project";

export default function ArtifactTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: ArtifactTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [overflowing, setOverflowing] = useState(false);

  // Centre the whole active group — label button AND close button — inside the
  // scrollport. Measuring the group (not the label button) is what keeps the
  // close affordance on screen at 375px, where the strip is narrower than its
  // content. Layout-bound and instant: no animation, no timer.
  const revealActiveTab = useCallback(() => {
    const container = scrollRef.current;
    const group = groupRefs.current[activeId];
    if (container === null || group === null || group === undefined) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    setOverflowing(maxScroll > 1);
    if (maxScroll <= 0) return;
    const centered =
      group.offsetLeft - (container.clientWidth - group.offsetWidth) / 2;
    container.scrollTo({
      left: Math.max(0, Math.min(centered, maxScroll)),
      behavior: "auto",
    });
  }, [activeId]);

  useLayoutEffect(() => {
    revealActiveTab();
    const container = scrollRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => revealActiveTab());
    observer.observe(container);
    return () => observer.disconnect();
  }, [revealActiveTab, tabs.length]);

  return (
    <div
      ref={scrollRef}
      aria-label="프로젝트 작업 탭"
      className={cn(
        "relative flex h-full w-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden px-2",
        // Edge fade + snap only while the strip actually overflows, so a
        // fitting strip carries no decoration and an overflowing one shows
        // where content continues.
        overflowing &&
          "snap-x snap-proximity [mask-image:linear-gradient(to_right,transparent_0px,#000_12px,#000_calc(100%-12px),transparent_100%)] focus-within:[mask-image:none]",
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          revealActiveTab();
        }
      }}
    >
      {tabs.map((tab) => {
        const Icon = tabIcon(tab.kind);
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            ref={(node) => {
              groupRefs.current[tab.id] = node;
            }}
            className="group flex h-full shrink-0 snap-center items-center"
          >
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              title={tab.relPath ?? tab.title}
              aria-pressed={isActive}
              className={cn(
                "flex h-full items-center gap-2 border-b-2 px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isActive
                  ? "border-accent bg-background text-accent"
                  : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground",
                tab.closeable && "pr-1.5",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[180px] truncate">{tab.title}</span>
            </button>
            {tab.closeable ? (
              <button
                type="button"
                onClick={() => onClose?.(tab.id)}
                className="mr-1 max-[900px]:min-h-11 max-[900px]:min-w-11 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                aria-label={`${tab.title} 탭 닫기`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function tabIcon(kind: ArtifactTab["kind"]) {
  switch (kind) {
    case "design_system":
      return Palette;
    case "design_files":
      return Folder;
    case "directions":
      return Compass;
    case "file":
      return FileCode;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
