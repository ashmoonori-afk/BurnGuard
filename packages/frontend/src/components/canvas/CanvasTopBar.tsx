import { useT, type MessageKey } from "@/i18n/t";
import { Eye, MessageSquare, MoreHorizontal, Paintbrush, Pencil, RefreshCw, ShieldCheck, SlidersHorizontal, Undo2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CanvasMode } from "@/components/modes/types";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import { quickCommentShortcutLabel } from "./quick-comment";
import { CANVAS_DEVICE_PRESETS, type CanvasDevicePreset } from "@/lib/canvas-device-width";
import { splitToolbarItems, type ToolbarOverflowItem } from "@/lib/toolbar-overflow";

export const MODES: Array<{ id: CanvasMode; label: MessageKey; icon: LucideIcon; hint: MessageKey }> = [
  { id: "edit", label: "canvas.toolbar.edit", icon: Pencil, hint: "canvas.toolbar.editHint" },
  { id: "tweaks", label: "canvas.toolbar.style", icon: SlidersHorizontal, hint: "canvas.toolbar.styleHint" },
  { id: "comment", label: "canvas.toolbar.comment", icon: MessageSquare, hint: "canvas.toolbar.commentHint" },
  { id: "draw", label: "canvas.toolbar.draw", icon: Paintbrush, hint: "canvas.toolbar.drawHint" },
  { id: "quality", label: "canvas.toolbar.quality", icon: ShieldCheck, hint: "canvas.toolbar.qualityHint" },
];

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const ROW_GAP = 4;
const MORE_BUTTON_WIDTH = 32;
const FALLBACK_ITEM_WIDTH = 160;
const ICON_BUTTON = "h-8 w-8 shrink-0 p-0 max-[900px]:h-9 max-[900px]:w-9";

type OptionalId = "device" | "palette" | "history";
const OVERFLOW_PRIORITY: Record<OptionalId, number> = { device: 1, palette: 2, history: 3 };

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function ToolTip({ label, hint, children, align = "center" }: { label: string; hint?: string; children: React.ReactElement; align?: "center" | "end" }) {
  return (
    <Tooltip
      side="bottom"
      className={align === "end" ? "left-auto right-0 translate-x-0" : undefined}
      content={<><span className="block font-medium">{label}</span>{hint && hint !== label ? <span className="block text-muted-foreground">{hint}</span> : null}</>}
    >
      {children}
    </Tooltip>
  );
}

export default function CanvasTopBar({
  devicePreset,
  onDevicePresetChange,
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
  devicePreset?: CanvasDevicePreset;
  onDevicePresetChange?: (preset: CanvasDevicePreset) => void;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Partial<Record<OptionalId, HTMLDivElement | null>>>({});
  const widthsRef = useRef<Partial<Record<OptionalId, number>>>({});
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY);
  const [measureTick, setMeasureTick] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  const present: OptionalId[] = [];
  if (devicePreset !== undefined) present.push("device");
  if (colorPalette) present.push("palette");
  if (historyTools) present.push("history");
  const items: ToolbarOverflowItem[] = present.map((id) => ({ id, width: widthsRef.current[id] ?? FALLBACK_ITEM_WIDTH, priority: OVERFLOW_PRIORITY[id] }));
  const split = splitToolbarItems(items, available, ROW_GAP, MORE_BUTTON_WIDTH);
  const overflowIds = new Set<string>(split.overflow);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const fixed = fixedRef.current;
    if (!root || !fixed) return;
    for (const [id, element] of Object.entries(itemRefs.current) as Array<[OptionalId, HTMLDivElement | null | undefined]>) {
      if (element && element.offsetParent !== null) widthsRef.current[id] = Math.ceil(element.getBoundingClientRect().width);
    }
    const style = getComputedStyle(root);
    const inner = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    setAvailable(Math.max(0, inner - fixed.getBoundingClientRect().width - ROW_GAP));
    setMeasureTick((tick) => tick + 1);
  }, []);

  useIsomorphicLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(() => measure());
    if (rootRef.current) observer.observe(rootRef.current);
    for (const element of Object.values(itemRefs.current)) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [measure, present.join(",")]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const hasOverflow = split.overflow.length > 0;
  useEffect(() => { if (!hasOverflow) setMoreOpen(false); }, [hasOverflow]);

  const slot = (id: OptionalId, content: ReactNode) => (
    <div ref={(element) => { itemRefs.current[id] = element; }} data-toolbar-item={id} className="flex shrink-0 items-center">{content}</div>
  );
  const optionalContent: Record<OptionalId, ReactNode> = {
    device: devicePreset === undefined ? null : <fieldset aria-label={t("canvas.device.width")} className="flex min-w-0 shrink-0 items-center gap-0.5 rounded-control bg-muted p-0.5">
      {CANVAS_DEVICE_PRESETS.map((preset) => <button
        key={preset}
        type="button"
        aria-pressed={devicePreset === preset}
        onClick={() => onDevicePresetChange?.(preset)}
        className={cn("h-7 rounded-control px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:h-8", devicePreset === preset ? "bg-background text-foreground shadow-app-1" : "text-muted-foreground hover:text-foreground")}
      >{t(`canvas.device.${preset}`)}</button>)}
    </fieldset>,
    palette: colorPalette,
    history: historyTools,
  };
  const inRow = present.filter((id) => !overflowIds.has(id));
  const inMore = present.filter((id) => overflowIds.has(id));

  return (
    <div ref={rootRef} data-measure-tick={measureTick} className="z-20 flex min-h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1">
      <div ref={fixedRef} aria-label={t("canvas.toolbar.tools")} className="flex shrink-0 items-center gap-0.5" role="group">
        <ToolTip label={t("canvas.toolbar.preview")}>
          <Button type="button" variant="ghost" size="icon" aria-label={t("canvas.toolbar.preview")} aria-pressed={mode === null} onClick={() => onModeChange(null)} className={cn(ICON_BUTTON, mode === null && "bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent")}>
            <Eye aria-hidden="true" />
          </Button>
        </ToolTip>
        {MODES.map((m) => {
          const active = m.id === mode;
          const Icon = m.icon;
          const hint = active ? t("canvas.toolbar.disableMode") : m.id === "comment" ? t("canvas.toolbar.commentHintShortcut", { shortcut: quickCommentShortcutLabel() }) : t(m.hint);
          return (
            <ToolTip key={m.id} label={t(m.label)} hint={hint}>
              <Button type="button" variant="ghost" size="icon" aria-label={t(m.label)} aria-pressed={active} disabled={readOnly} onClick={() => onModeChange(active ? null : m.id)} className={cn(ICON_BUTTON, active && "bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent")}>
                <Icon aria-hidden="true" />
              </Button>
            </ToolTip>
          );
        })}
        <Divider />
        <ToolTip label={t("canvas.toolbar.undo")} hint={canUndo ? t("canvas.toolbar.undoHint") : t("canvas.toolbar.noUndo")}>
          <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} aria-label={t("canvas.toolbar.undo")} onClick={onUndo} disabled={readOnly || !canUndo || undoPending || !onUndo}>
            <Undo2 aria-hidden="true" />
          </Button>
        </ToolTip>
        <ToolTip label={t("canvas.toolbar.refresh")}>
          <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} aria-label={t("canvas.toolbar.refresh")} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </ToolTip>
      </div>

      {inRow.length > 0 && <Divider />}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {inRow.map((id) => <div key={id} className="flex shrink-0 items-center">{slot(id, optionalContent[id])}</div>)}
      </div>

      {present.length > 0 && <div ref={moreRef} className={cn("relative ml-auto shrink-0", !hasOverflow && "hidden")}>
        <ToolTip label={t("canvas.toolbar.more")} hint={t("canvas.toolbar.moreHint")} align="end">
          <Button type="button" variant="ghost" size="icon" className={cn(ICON_BUTTON, moreOpen && "bg-muted")} aria-label={t("canvas.toolbar.more")} aria-expanded={moreOpen} aria-haspopup="true" onClick={() => setMoreOpen((open) => !open)}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </ToolTip>
        <div role="group" aria-label={t("canvas.toolbar.more")} className={cn("absolute right-0 top-full z-50 mt-1 flex w-max max-w-[calc(100vw-1rem)] flex-col items-stretch gap-2 rounded-card border border-border bg-popover p-2 text-popover-foreground shadow-app-3", !moreOpen && "hidden")}>
          {inMore.map((id) => <div key={id} className="flex flex-wrap items-center gap-1">{slot(id, optionalContent[id])}</div>)}
        </div>
      </div>}
    </div>
  );
}
