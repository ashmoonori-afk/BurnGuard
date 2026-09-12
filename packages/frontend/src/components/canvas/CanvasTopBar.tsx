import { useT, type MessageKey } from "@/i18n/t";
import { Eye, MessageSquare, MousePointer2, Paintbrush, Pencil, RefreshCw, ShieldCheck, SlidersHorizontal, Undo2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasMode } from "@/components/modes/types";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

const MODES: Array<{ id: CanvasMode; label: MessageKey; icon: LucideIcon; hint: MessageKey }> = [
  { id: "edit", label: "canvas.toolbar.edit", icon: Pencil, hint: "canvas.toolbar.editHint" },
  { id: "tweaks", label: "canvas.toolbar.style", icon: SlidersHorizontal, hint: "canvas.toolbar.styleHint" },
  { id: "comment", label: "canvas.toolbar.comment", icon: MessageSquare, hint: "canvas.toolbar.commentHint" },
  { id: "draw", label: "canvas.toolbar.draw", icon: Paintbrush, hint: "canvas.toolbar.drawHint" },
  { id: "select", label: "canvas.toolbar.select", icon: MousePointer2, hint: "canvas.toolbar.selectHint" },
  { id: "quality", label: "canvas.toolbar.quality", icon: ShieldCheck, hint: "canvas.toolbar.qualityHint" },
];

export default function CanvasTopBar({
  mode,
  onModeChange,
  onRefresh,
  canUndo = false,
  undoPending = false,
  onUndo,
  colorPalette,
  historyTools,
  readOnly = false,
}: {
  mode: CanvasMode | null;
  onModeChange: (m: CanvasMode | null) => void;
  onRefresh: () => void;
  /**
   * Whether the active file has a single-step undo entry available.
   * Audit fix #7: shows after any GUI patch (Edit / Tweaks save)
   * and clears once the undo runs or the next patch overwrites it.
   */
  canUndo?: boolean;
  undoPending?: boolean;
  onUndo?: () => void;
  colorPalette?: ReactNode;
  historyTools?: ReactNode;
  readOnly?: boolean;
}) {
  const t = useT();
  return (
    <div className="z-20 shrink-0 border-b border-border bg-background px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1 min-[901px]:flex-nowrap">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 min-[901px]:flex-nowrap" aria-label={t("canvas.toolbar.tools")}>
        <button type="button" title={t("canvas.toolbar.preview")} aria-label={t("canvas.toolbar.preview")} onClick={() => onModeChange(null)} aria-pressed={mode === null} className={cn("flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium max-[900px]:min-h-11", mode === null ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Eye className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={mode === null ? "hidden min-[1100px]:inline" : "hidden min-[1500px]:inline"}>{t("canvas.toolbar.preview")}</span></button>
        {MODES.map((m) => {
          const active = m.id === mode;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onModeChange(active ? null : m.id)}
              aria-pressed={active}
              aria-label={t(m.label)}
              disabled={readOnly}
              title={active ? t("canvas.toolbar.disableMode") : t(m.hint)}
              className={cn(
                "flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={active || m.id === "quality" ? "hidden min-[1100px]:inline" : "hidden min-[1500px]:inline"}>{t(m.label)}</span>
            </button>
          );
        })}
        {colorPalette}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-border pl-1">
        {historyTools}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 max-[900px]:h-11 max-[900px]:w-11"
          aria-label={t("canvas.toolbar.undo")}
          onClick={onUndo}
          disabled={readOnly || !canUndo || undoPending || !onUndo}
          title={
            canUndo
              ? t("canvas.toolbar.undoHint")
              : t("canvas.toolbar.noUndo")
          }
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 max-[900px]:h-11 max-[900px]:w-11"
          aria-label={t("canvas.toolbar.refresh")}
          onClick={onRefresh}
          title={t("canvas.toolbar.refresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      </div>
    </div>
  );
}
