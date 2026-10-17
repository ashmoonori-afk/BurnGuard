import { useT, type MessageKey } from "@/i18n/t";
import { Pencil, Square, ArrowUpRight, Check, Undo2, Redo2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DrawTool } from "@/components/canvas/DrawLayer";
import { ModePanelHeader, PanelSectionLabel } from "./ModePanelHeader";

const TOOLS: Array<{ id: DrawTool; label: MessageKey; icon: typeof Pencil }> = [
  { id: "pen", label: "modes.draw.pen", icon: Pencil },
  { id: "rect", label: "modes.draw.rectangle", icon: Square },
  { id: "arrow", label: "modes.draw.arrow", icon: ArrowUpRight },
];

const COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#111827"];
const WIDTHS: Array<{ value: number; label: MessageKey }> = [
  { value: 2, label: "modes.draw.widthThin" },
  { value: 4, label: "modes.draw.widthMedium" },
  { value: 6, label: "modes.draw.widthThick" },
];

export default function DrawPanel({
  tool,
  color,
  strokeWidth,
  onChangeTool,
  onChangeColor,
  onChangeWidth,
  onUndo,
  onRedo,
  onClear,
  onClose,
  hasShapes,
  canRedo,
}: {
  tool: DrawTool;
  color: string;
  strokeWidth: number;
  onChangeTool: (t: DrawTool) => void;
  onChangeColor: (c: string) => void;
  onChangeWidth: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onClose?: () => void;
  hasShapes: boolean;
  canRedo: boolean;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <ModePanelHeader title={t("modes.draw.title")} description={t("modes.draw.description")} onClose={onClose} />

      <section className="border-b border-border px-3 py-3">
        <PanelSectionLabel>{t("modes.draw.tools")}</PanelSectionLabel>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={t("modes.draw.toolGroup")}>
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={tool === item.id}
              onClick={() => onChangeTool(item.id)}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-control border px-2 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                tool === item.id
                  ? "border-accent bg-accent/10 font-medium text-accent"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {t(item.label)}
            </button>
          ))}
        </div>
      </section>

      <section className="border-b border-border px-3 py-3">
        <PanelSectionLabel>{t("modes.color")}</PanelSectionLabel>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("modes.color")}>
          {COLORS.map((c) => {
            const selected = color === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChangeColor(c)}
                title={c}
                aria-label={t("modes.draw.colorLabel", { color: c })}
                className="relative flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-[900px]:h-11 max-[900px]:w-11"
              >
                <span
                  className={cn(
                    "block h-7 w-7 rounded-full border border-foreground/40",
                    selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                  style={{ backgroundColor: c }}
                />
                {selected && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-b border-border px-3 py-3">
        <PanelSectionLabel>{t("modes.draw.strokeWidth")}</PanelSectionLabel>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={t("modes.draw.strokeWidth")}>
          {WIDTHS.map((w) => (
            <button
              key={w.value}
              type="button"
              role="radio"
              aria-checked={strokeWidth === w.value}
              onClick={() => onChangeWidth(w.value)}
              aria-label={t("modes.draw.widthLabel", { width: w.value })}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-control border px-2 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                strokeWidth === w.value
                  ? "border-accent bg-accent/10 font-medium text-accent"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="inline-block rounded-full bg-current" style={{ width: w.value * 2, height: w.value * 2 }} aria-hidden="true" />
              {t(w.label)}
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 px-3 py-3">
        <Button type="button" variant="outline" size="sm" onClick={onUndo} disabled={!hasShapes} title={t("modes.draw.undoShortcut")}>
          <Undo2 aria-hidden="true" />{t("modes.undo")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRedo} disabled={!canRedo} title={t("modes.draw.redoShortcut")}>
          <Redo2 aria-hidden="true" />{t("modes.redo")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={onClear} disabled={!hasShapes} title={t("modes.draw.clearHint")}>
          <Trash2 aria-hidden="true" />{t("modes.draw.clearAll")}
        </Button>
      </div>
    </div>
  );
}
