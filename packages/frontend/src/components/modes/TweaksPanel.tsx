import { useT, type MessageKey } from "@/i18n/t";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { dimensionPatch, isAspectLocked, MAX_ELEMENT_SIZE, rotationPatch, targetDimensions } from "@/lib/element-geometry";
import { parseLocalFonts } from "@bg/shared";
import { apiFetch } from "@/api/client";
import {
  TWEAKS_STYLE_KEYS,
  type TweaksStyleKey,
  type TweaksTarget,
} from "@/components/canvas/TweaksLayer";
import { BRAND_PALETTE } from "./tweaks-palette";
import {
  composeSides,
  normalizeHex,
  numericFromLength,
  parseSides,
  type Sides,
} from "./tweaks-utils";

type ApplyFn = (patch: Partial<Record<TweaksStyleKey, string | null>>) => void;

export interface TweakChangePreview {
  property: TweaksStyleKey;
  from: string;
  to: string;
}

export function buildTweakChangePreview(
  target: TweaksTarget,
  patch: Partial<Record<TweaksStyleKey, string | null>>,
): TweakChangePreview | null {
  for (const property of TWEAKS_STYLE_KEYS) {
    const next = patch[property];
    if (next === undefined) continue;
    return {
      property,
      from: target.inline[property] ?? target.computed[property] ?? "unset",
      to: next ?? "unset",
    };
  }
  return null;
}

const BUNDLED_FONTS = ["DM Sans", "Space Grotesk", "DM Serif Display", "Bebas Neue", "IBM Plex Mono", "Gowun Batang", "Pretendard"];

const FONT_WEIGHTS: Array<{ value: string; label: MessageKey }> = [
  { value: "300", label: "modes.tweaks.weight300" },
  { value: "400", label: "modes.tweaks.weight400" },
  { value: "500", label: "modes.tweaks.weight500" },
  { value: "600", label: "modes.tweaks.weight600" },
  { value: "700", label: "modes.tweaks.weight700" },
  { value: "800", label: "modes.tweaks.weight800" },
];

const TRANSPARENT_RE = /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i;
const SIZE_RULES: Record<
  TweaksStyleKey,
  { min: number; max: number; allowNegative: boolean }
> = {
  width: { min: 1, max: MAX_ELEMENT_SIZE, allowNegative: false },
  height: { min: 1, max: MAX_ELEMENT_SIZE, allowNegative: false },
  rotate: { min: -180, max: 180, allowNegative: true },
  "aspect-ratio": { min: 0, max: 0, allowNegative: false },
  "box-sizing": { min: 0, max: 0, allowNegative: false },
  display: { min: 0, max: 0, allowNegative: false },
  "font-family": { min: 0, max: 0, allowNegative: false },
  "font-size": { min: 8, max: 240, allowNegative: false },
  "font-weight": { min: 100, max: 900, allowNegative: false },
  color: { min: 0, max: 0, allowNegative: false },
  "line-height": { min: 8, max: 320, allowNegative: false },
  "letter-spacing": { min: -8, max: 24, allowNegative: true },
  "background-color": { min: 0, max: 0, allowNegative: false },
  padding: { min: 0, max: 320, allowNegative: false },
  margin: { min: -320, max: 320, allowNegative: true },
  "border-radius": { min: 0, max: 320, allowNegative: false },
};

/** Simple geometry first; the existing style controls remain under Advanced. */
export default function TweaksPanel({ target, saving, onApply, onResetAll, onClear, review }: {
  target: TweaksTarget | null;
  saving: boolean;
  onApply: ApplyFn;
  onResetAll: () => void;
  onClear: () => void;
  review: TweakChangePreview | null;
}) {
  const t = useT();
  if (!target) return <div className="p-4"><h2 className="text-sm font-semibold">{t("modes.tweaks.select")}</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("modes.tweaks.selectHint")}</p></div>;
  return <div className="flex min-h-0 flex-col overflow-y-auto">
    <header className="flex items-center justify-between border-b border-border px-3 py-2">
      <h2 className="text-sm font-semibold">{t("modes.tweaks.selected")}</h2>
      <button type="button" onClick={onClear} className="min-h-10 rounded px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("modes.clearSelection")}</button>
    </header>
    <GeometryControls key={target.bg_id} target={target} saving={saving} onApply={onApply} />
    <details className="border-t border-border">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("modes.tweaks.advanced")}</summary>
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">&lt;{target.tag}&gt; · {target.bg_id}</span>
        <button type="button" onClick={onResetAll} disabled={saving || Object.keys(target.inline).length === 0} className="min-h-10 shrink-0 rounded px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring">{t("modes.tweaks.resetStyles")}</button>
      </div>
      <section className="border-t border-border px-3 py-3">
        <SectionHeader>{t("modes.tweaks.fontsColors")}</SectionHeader>
        <div className="mt-2 flex flex-col gap-2">
          <FontFamilyRow target={target} saving={saving} onApply={onApply} />
          <SizeRow target={target} styleKey="font-size" saving={saving} onApply={onApply} />
          <FontWeightRow target={target} saving={saving} onApply={onApply} />
          <ColorRow target={target} styleKey="color" saving={saving} onApply={onApply} />
          <ColorRow target={target} styleKey="background-color" saving={saving} onApply={onApply} />
          <SizeRow target={target} styleKey="line-height" saving={saving} onApply={onApply} />
          <SizeRow target={target} styleKey="letter-spacing" saving={saving} onApply={onApply} />
        </div>
      </section>
      <section className="border-t border-border px-3 py-3">
        <SectionHeader>{t("modes.tweaks.spacingCorners")}</SectionHeader>
        <div className="mt-2 flex flex-col gap-2">
          <SidesRow target={target} styleKey="padding" saving={saving} onApply={onApply} />
          <SidesRow target={target} styleKey="margin" saving={saving} onApply={onApply} />
          <SidesRow target={target} styleKey="border-radius" saving={saving} onApply={onApply} />
        </div>
      </section>
      {review && <section aria-label={t("modes.tweaks.lastChange")} className="border-t border-border px-3 py-3"><SectionHeader>{t("modes.tweaks.lastChange")}</SectionHeader><p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{review.property}: {review.from} → {review.to}</p></section>}
    </details>
  </div>;
}

function GeometryControls({ target, saving, onApply }: { target: TweaksTarget; saving: boolean; onApply: ApplyFn }) {
  const t = useT();
  const { width, height, rotation } = targetDimensions(target);
  const locked = isAspectLocked(target);
  return <section aria-label={t("modes.tweaks.geometry")} className="m-3 space-y-3 rounded-lg border border-border bg-card p-3">
    <div className="grid grid-cols-2 gap-3">
      <GeometryNumber label={t("modes.width")} unit="px" value={width} min={1} max={MAX_ELEMENT_SIZE} disabled={saving} onCommit={value => onApply(dimensionPatch(target, value, height, locked))} />
      <GeometryNumber label={t("modes.height")} unit="px" value={height} min={1} max={MAX_ELEMENT_SIZE} disabled={saving} onCommit={value => onApply(dimensionPatch(target, width, value, locked))} />
      <GeometryNumber label={t("modes.rotation")} unit="°" value={rotation} min={-360} max={360} disabled={saving} onCommit={value => onApply(rotationPatch(value))} />
      <label className="block text-xs">{t("modes.tweaks.ratio")}<select aria-label={t("modes.tweaks.ratio")} disabled={saving} value={locked ? "locked" : "free"} onChange={event => {
          const value = event.target.value;
          if (value === "free" || value === "locked") onApply({ "aspect-ratio": value === "free" ? "auto" : `${width} / ${height}` });
          else { const ratio = Number(value); onApply({ ...dimensionPatch(target, width, width / ratio, false), "aspect-ratio": `${ratio} / 1` }); }
        }} className="mt-1 min-h-10 w-full rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="free">{t("modes.tweaks.freeRatio")}</option><option value="locked">{t("modes.tweaks.lockRatio")}</option><option value="1">1 : 1</option><option value="1.3333333333333333">4 : 3</option><option value="1.7777777777777777">16 : 9</option><option value="0.5625">9 : 16</option>
        </select>
      </label>
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("modes.tweaks.dragHint")}<br />{t("modes.tweaks.shortcuts")}</p>
  </section>;
}

function GeometryNumber({ label, unit, value, min, max, disabled, onCommit }: { label: string; unit: string; value: number; min: number; max: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const next = Math.min(max, Math.max(min, parsed));
    setDraft(String(next));
    if (Math.abs(next - value) > 0.005) onCommit(next);
  };
  return <label className="block text-xs">{label}<span className="mt-1 flex min-h-10 items-center rounded border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
    <input aria-label={label} type="number" step="0.1" min={min} max={max} value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={event => commitTweakOnBlur(event.currentTarget, commit)} onKeyDown={event => handleEnterEscape(event, commit, () => setDraft(String(value)))} className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none" />
    <span className="pr-2 text-muted-foreground">{unit}</span>
  </span></label>;
}

function FontFamilyRow({ target, saving, onApply }: { target: TweaksTarget; saving: boolean; onApply: ApplyFn }) {
  const t = useT();
  const [families, setFamilies] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MessageKey | "">("");
  const inline = target.inline["font-family"] ?? "";
  const load = async () => {
    setLoading(true); setError("");
    try {
      const query = (window as Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
      // Browser permission remains an explicit user gesture. Unsupported hosts use Windows' native family list.
      const result = query
        ? parseLocalFonts({ schema_version: 1, families: [...new Set((await query.call(window)).map((font) => font.family))] })
        : parseLocalFonts(await apiFetch<unknown>("/api/settings/local-fonts"));
      setFamilies(result.families);
    } catch { setError("modes.tweaks.fontLoadError"); }
    finally { setLoading(false); }
  };
  return <div className="space-y-1">
    <label className="flex items-center gap-2 text-[11px]">
      <RowLabel>{t("modes.tweaks.font")}</RowLabel>
      <select className={inputCls("min-w-0 flex-1")} value={inline} disabled={saving} onChange={(event) => onApply({ "font-family": event.target.value || null })}>
        <option value="">{t("modes.tweaks.inheritedValue", { value: target.computed["font-family"] || t("modes.tweaks.default") })}</option>
        {inline && ![...BUNDLED_FONTS, ...families].some((family) => JSON.stringify(family) === inline) && <option value={inline}>{inline}</option>}
        {BUNDLED_FONTS.map((family) => <option key={family} value={JSON.stringify(family)}>{family}</option>)}
        {families.filter((family) => !BUNDLED_FONTS.includes(family)).map((family) => <option key={family} value={JSON.stringify(family)}>{family}</option>)}
      </select>
    </label>
    <p className="text-[10px] text-muted-foreground">{t("modes.tweaks.bundledFontsHint")}</p>
    <button type="button" className="text-[10px] underline" disabled={loading} onClick={() => void load()}>{loading ? t("modes.tweaks.loadingFonts") : t("modes.tweaks.loadFonts")}</button>
    {error && <p role="alert" className="text-[10px] text-destructive">{t(error)}</p>}
    {families.length > 0 && <p role="status" className="text-[10px] text-muted-foreground">{t("modes.tweaks.installedFonts", { count: families.length })}</p>}
  </div>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-[96px] shrink-0 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

function inputCls(extra?: string) {
  return cn(
    "rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]",
    "focus:outline-none focus:ring-1 focus:ring-emerald-500",
    extra,
  );
}

function SizeRow({
  target,
  styleKey,
  saving,
  onApply,
}: {
  target: TweaksTarget;
  styleKey: TweaksStyleKey;
  saving: boolean;
  onApply: ApplyFn;
}) {
  const inline = target.inline[styleKey] ?? "";
  const computed = target.computed[styleKey] ?? "";
  const [draft, setDraft] = useState(numericFromLength(inline));

  useEffect(() => {
    setDraft(numericFromLength(inline));
  }, [inline, target.bg_id, styleKey]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (inline) onApply({ [styleKey]: null });
      return;
    }
    const parsed = parseDraftLength(trimmed);
    if (parsed === null) {
      setDraft(numericFromLength(inline));
      return;
    }
    const rule = SIZE_RULES[styleKey];
    if ((!rule.allowNegative && parsed < 0) || !Number.isFinite(parsed)) {
      setDraft(numericFromLength(inline));
      return;
    }
    const clamped = clamp(parsed, rule.min, rule.max);
    const normalized = formatLengthNumber(clamped);
    const next = `${normalized}px`;
    if (next === inline) return;
    if (normalized !== trimmed) {
      setDraft(normalized);
    }
    onApply({ [styleKey]: next });
  };

  return (
    <label className="flex items-center gap-2 text-[11px]">
      <RowLabel>{styleKey}</RowLabel>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={numericFromLength(computed) || computed || "—"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commitTweakOnBlur(e.currentTarget, commit)}
        onKeyDown={(e) => handleEnterEscape(e, commit, () => setDraft(numericFromLength(inline)))}
        disabled={saving}
        className={inputCls("min-w-0 flex-1")}
      />
      <span className="w-6 shrink-0 text-[10px] text-muted-foreground">px</span>
    </label>
  );
}

function FontWeightRow({
  target,
  saving,
  onApply,
}: {
  target: TweaksTarget;
  saving: boolean;
  onApply: ApplyFn;
}) {
  const t = useT();
  const inline = target.inline["font-weight"] ?? "";
  const computed = target.computed["font-weight"] ?? "";

  return (
    <label className="flex items-center gap-2 text-[11px]">
      <RowLabel>{t("modes.tweaks.fontWeight")}</RowLabel>
      <select
        value={inline}
        onChange={(e) => {
          const value = e.target.value;
          onApply({ "font-weight": value === "" ? null : value });
        }}
        disabled={saving}
        className={inputCls("min-w-0 flex-1")}
      >
        <option value="">
          {computed ? t("modes.tweaks.inheritedValue", { value: computed }) : t("modes.tweaks.inherit")}
        </option>
        {FONT_WEIGHTS.map((w) => (
          <option key={w.value} value={w.value}>
            {t(w.label)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorRow({
  target,
  styleKey,
  saving,
  onApply,
}: {
  target: TweaksTarget;
  styleKey: TweaksStyleKey;
  saving: boolean;
  onApply: ApplyFn;
}) {
  const t = useT();
  const inline = target.inline[styleKey] ?? "";
  const computed = target.computed[styleKey] ?? "";
  const effective = inline || computed;
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(inline);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHexDraft(inline);
  }, [inline, target.bg_id, styleKey]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!popoverRef.current) return;
      if (
        event.target instanceof Node &&
        !popoverRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (hex: string) => {
    onApply({ [styleKey]: hex });
    setOpen(false);
  };

  const commitHex = () => {
    const trimmed = hexDraft.trim();
    if (trimmed === "") {
      if (inline) onApply({ [styleKey]: null });
      setOpen(false);
      return;
    }
    const normalized = normalizeHex(trimmed);
    if (!normalized) {
      setHexDraft(inline);
      return;
    }
    onApply({ [styleKey]: normalized });
    setOpen(false);
  };

  const clear = () => {
    if (inline) onApply({ [styleKey]: null });
    setOpen(false);
  };

  const showTransparent = !effective || TRANSPARENT_RE.test(effective);

  return (
    <div ref={popoverRef} className="relative">
      <label className="flex items-center gap-2 text-[11px]">
        <RowLabel>{styleKey}</RowLabel>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={saving}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]",
            "hover:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500",
            saving && "opacity-50",
          )}
        >
          <span
            className="h-3.5 w-3.5 shrink-0 rounded-sm border border-border"
            style={
              showTransparent
                ? {
                    backgroundImage:
                      "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)",
                    backgroundSize: "6px 6px",
                    backgroundPosition: "0 0, 3px 3px",
                  }
                : { backgroundColor: effective }
            }
          />
          <span className="min-w-0 flex-1 truncate text-left">
            {inline || (effective && !showTransparent ? "—" : "—")}
          </span>
        </button>
      </label>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-[240px] rounded border border-border bg-popover p-2 shadow-lg">
          {BRAND_PALETTE.map((group) => (
            <div key={group.title} className="mb-2 last:mb-0">
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                {t(group.title)}
              </div>
              <div className="grid grid-cols-8 gap-1">
                {group.swatches.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => pick(s.hex)}
                    title={`${s.name} ${s.hex}`}
                    className="h-5 w-5 rounded border border-border hover:ring-2 hover:ring-emerald-500"
                    style={{ backgroundColor: s.hex }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-center gap-1">
            <input
              type="text"
              placeholder="#ffffff"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onKeyDown={(e) => handleEnterEscape(e, commitHex, () => setOpen(false))}
              onBlur={(e) => commitTweakOnBlur(e.currentTarget, commitHex)}
              className={inputCls("min-w-0 flex-1")}
            />
            <button
              type="button"
              onClick={clear}
              disabled={!inline}
              className={cn(
                "rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground",
                !inline && "opacity-50 cursor-not-allowed",
              )}
              title={t("modes.tweaks.clearOverride")}
            >
              {t("modes.tweaks.clear")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SidesRow({
  target,
  styleKey,
  saving,
  onApply,
}: {
  target: TweaksTarget;
  styleKey: TweaksStyleKey;
  saving: boolean;
  onApply: ApplyFn;
}) {
  const t = useT();
  const inline = target.inline[styleKey] ?? "";
  const computed = target.computed[styleKey] ?? "";
  const initial = numericSidesFrom(inline || computed);
  const [sides, setSides] = useState<Sides>(initial);

  useEffect(() => {
    setSides(numericSidesFrom(inline || computed));
  }, [inline, computed, target.bg_id, styleKey]);

  const commitSide = (side: keyof Sides) => (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (trimmed !== "" && !/^-?\d*\.?\d+$/.test(trimmed)) {
      // Reject non-numeric; drop back to the last accepted numeric.
      setSides((prev) => ({ ...prev, [side]: prev[side] }));
      return;
    }
    const next: Sides = { ...sides, [side]: trimmed };
    setSides(next);
    const allEmpty =
      !next.top && !next.right && !next.bottom && !next.left;
    if (allEmpty) {
      if (inline) onApply({ [styleKey]: null });
      return;
    }
    const withUnit: Sides = {
      top: next.top === "" ? "0px" : `${next.top}px`,
      right: next.right === "" ? "0px" : `${next.right}px`,
      bottom: next.bottom === "" ? "0px" : `${next.bottom}px`,
      left: next.left === "" ? "0px" : `${next.left}px`,
    };
    const shorthand = composeSides(withUnit);
    if (shorthand && shorthand !== inline) {
      onApply({ [styleKey]: shorthand });
    } else if (!shorthand && inline) {
      onApply({ [styleKey]: null });
    }
  };

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <RowLabel>{styleKey}</RowLabel>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <SideInput title={t("modes.tweaks.top")} value={sides.top} onCommit={commitSide("top")} disabled={saving} />
        <SideInput title={t("modes.tweaks.right")} value={sides.right} onCommit={commitSide("right")} disabled={saving} />
        <SideInput title={t("modes.tweaks.bottom")} value={sides.bottom} onCommit={commitSide("bottom")} disabled={saving} />
        <SideInput title={t("modes.tweaks.left")} value={sides.left} onCommit={commitSide("left")} disabled={saving} />
      </div>
      <span className="w-6 shrink-0 text-[10px] text-muted-foreground">px</span>
    </div>
  );
}

function SideInput({
  title,
  value,
  onCommit,
  disabled,
}: {
  title: string;
  value: string;
  onCommit: (v: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      title={title}
      aria-label={title}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commitTweakOnBlur(e.currentTarget, () => onCommit(draft))}
      onKeyDown={(e) =>
        handleEnterEscape(
          e,
          () => onCommit(draft),
          () => setDraft(value),
        )
      }
      disabled={disabled}
      className={inputCls(
        "w-0 min-w-0 flex-1 text-center text-[10px] px-1",
      )}
    />
  );
}

const handledBlurInputs = new WeakSet<HTMLInputElement>();

export function commitTweakOnBlur(input: HTMLInputElement, commit: () => void) {
  if (!handledBlurInputs.has(input)) commit();
}

export function handleEnterEscape(
  e: ReactKeyboardEvent<HTMLInputElement>,
  onEnter: () => void,
  onEscape: () => void,
) {
  if (e.key !== "Enter" && e.key !== "Escape") return;
  e.preventDefault();
  const input = e.currentTarget;
  // blur fires synchronously, before React applies the restored draft.
  handledBlurInputs.add(input);
  try {
    if (e.key === "Enter") onEnter();
    else onEscape();
    input.blur();
  } finally {
    handledBlurInputs.delete(input);
  }
}

function numericSidesFrom(raw: string): Sides {
  const parsed = parseSides(raw);
  return {
    top: numericFromLength(parsed.top),
    right: numericFromLength(parsed.right),
    bottom: numericFromLength(parsed.bottom),
    left: numericFromLength(parsed.left),
  };
}

function parseDraftLength(value: string): number | null {
  const match = value.trim().match(/^(-?\d*\.?\d+)(?:px)?$/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatLengthNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
