import { useT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GRAPHIC_PRESETS,
  PROJECT_LABEL_CLASS,
} from "@/lib/project-creation";

export function GraphicCanvasFields({
  width,
  height,
  disabled,
  onChange,
}: {
  readonly width: number;
  readonly height: number;
  readonly disabled: boolean;
  readonly onChange: (size: { readonly width: number; readonly height: number }) => void;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-3 border-t border-border pt-4">
      <legend className="text-xs font-medium text-foreground/80">
        {t("home.graphic.size")}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="graphic-width" className={PROJECT_LABEL_CLASS}>
            {t("home.graphic.width")}
          </label>
          <Input
            id="graphic-width"
            type="number"
            inputMode="numeric"
            min={320}
            max={4096}
            step={1}
            value={width}
            disabled={disabled}
            onChange={(event) => onChange({ width: Number(event.target.value), height })}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="graphic-height" className={PROJECT_LABEL_CLASS}>
            {t("home.graphic.height")}
          </label>
          <Input
            id="graphic-height"
            type="number"
            inputMode="numeric"
            min={240}
            max={16384}
            step={1}
            value={height}
            disabled={disabled}
            onChange={(event) => onChange({ width, height: Number(event.target.value) })}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {GRAPHIC_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="outline"
            className="h-auto min-h-11 flex-col gap-0.5 px-2 text-xs"
            disabled={disabled}
            aria-label={t("home.graphic.presetAria", { name: t(preset.label), width: String(preset.width), height: String(preset.height), unavailable: "", unverified: "" })}
            onClick={() => onChange(preset)}
          >
            <span>{t(preset.label)}</span>
            <span className="font-mono text-[10px] text-foreground/70">
              {preset.width}×{preset.height}
            </span>
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
