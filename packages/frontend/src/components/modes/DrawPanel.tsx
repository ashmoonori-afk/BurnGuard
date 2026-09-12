import { useT, type MessageKey } from "@/i18n/t";
import { Pencil, Square, ArrowUpRight, Undo2, Redo2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrawTool } from "@/components/canvas/DrawLayer";

const TOOLS: Array<{ id: DrawTool; label: MessageKey; icon: typeof Pencil }> = [
  { id: "pen", label: "modes.draw.pen", icon: Pencil },
  { id: "rect", label: "modes.draw.rectangle", icon: Square },
  { id: "arrow", label: "modes.draw.arrow", icon: ArrowUpRight },
];

const COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#111827"];
const WIDTHS = [2, 4, 6];

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
  hasShapes,
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
  hasShapes: boolean;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">
          {t("modes.draw.title")}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("modes.draw.description")}
        </p>
      </div>

      <section className="px-3 py-2 border-b border-border">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
          {t("modes.draw.tools")}
        </div>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={t("modes.draw.toolGroup")}>
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={tool === item.id}
              onClick={() => onChangeTool(item.id)}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs transition-colors",
                tool === item.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {t(item.label)}
            </button>
          ))}
        </div>
      </section>

      <section className="px-3 py-2 border-b border-border">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
          {t("modes.color")}
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("modes.color")}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              onClick={() => onChangeColor(c)}
              title={c}
              aria-label={t("modes.draw.colorLabel", { color: c })}
              className={cn(
                "h-9 w-9 rounded-full border-4 transition-transform max-[900px]:h-11 max-[900px]:w-11",
                color === c ? "border-foreground scale-110" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </section>

      <section className="px-3 py-2 border-b border-border">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
          {t("modes.draw.strokeWidth")}
        </div>
        <div className="flex gap-1.5" role="radiogroup" aria-label={t("modes.draw.strokeWidth")}>
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={strokeWidth === w}
              onClick={() => onChangeWidth(w)}
              aria-label={t("modes.draw.widthLabel", { width: w })}
              className={cn(
                "flex h-10 w-12 items-center justify-center rounded-lg border text-xs transition-colors max-[900px]:h-11",
                strokeWidth === w
                  ? "border-foreground bg-muted"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className="inline-block rounded-full bg-foreground"
                style={{ width: w * 2, height: w * 2 }}
              />
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 px-3 py-3">
        <button
          type="button"
          onClick={onUndo}
          disabled={!hasShapes}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("modes.draw.undoShortcut")}
        >
          <Undo2 className="h-3 w-3" />{" "}{t("modes.undo")}
        </button>
        <button
          type="button"
          onClick={onRedo}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:text-foreground"
          title={t("modes.draw.redoShortcut")}
        >
          <Redo2 className="h-3 w-3" />{" "}{t("modes.redo")}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!hasShapes}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("modes.draw.clearHint")}
        >
          <Trash2 className="h-3 w-3" />{" "}{t("modes.draw.clearAll")}
        </button>
      </div>
    </div>
  );
}
