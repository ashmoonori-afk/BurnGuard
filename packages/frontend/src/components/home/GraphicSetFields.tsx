import type { GraphicFrameV1, GraphicSetKind } from "@bg/shared";
import { useT } from "@/i18n/t";
import { Input } from "@/components/ui/input";
import {
  DETAIL_BRIEF_FIELDS,
  DETAIL_BRIEF_MAX_LENGTH,
  GRAPHIC_FRAME_COUNT_LIMIT,
  GRAPHIC_KIND_CHOICES,
  defaultFrameCount,
  presetChoicesFor,
} from "@/lib/graphic-set-form";
import {
  PROJECT_CONTROL_CLASS,
  PROJECT_LABEL_CLASS,
  type BriefForm,
} from "@/lib/project-creation";

const SINGLE_FRAME_KINDS: readonly GraphicSetKind[] = ["single", "product_detail"];

function defaultFrame(form: BriefForm): GraphicFrameV1 {
  return { width: form.graphicWidth, height: form.graphicHeight, label: "" };
}

function resizeFrames(
  frames: readonly GraphicFrameV1[],
  count: number,
  fill: GraphicFrameV1,
): readonly GraphicFrameV1[] {
  return Array.from({ length: count }, (_, index) => frames[index] ?? fill);
}

/**
 * Graphic set choices of doc/14 sections 4.1 and 4.2. Every control writes into
 * the same draft the shared parser validates, so an impossible combination is
 * refused by the panel before create.
 */
export function GraphicSetFields({
  form,
  disabled,
  onChange,
}: {
  readonly form: BriefForm;
  readonly disabled: boolean;
  readonly onChange: (patch: Partial<BriefForm>) => void;
}) {
  const t = useT();
  const kind = form.graphicKind;
  const multiFrame = !SINGLE_FRAME_KINDS.includes(kind);
  const presets = presetChoicesFor(kind);

  function pickKind(next: GraphicSetKind) {
    const count = defaultFrameCount(next);
    onChange({
      graphicKind: next,
      frameCount: count,
      presetId: null,
      frames: next === "banner_set" ? resizeFrames([], count, defaultFrame(form)) : [],
      detailBrief: next === "product_detail" ? form.detailBrief : {},
    });
  }

  function pickFrameCount(count: number) {
    onChange({
      frameCount: count,
      ...(kind === "banner_set" && Number.isSafeInteger(count)
        ? { frames: resizeFrames(form.frames, Math.max(count, 0), defaultFrame(form)) }
        : {}),
    });
  }

  return (
    <fieldset className="space-y-4 border-t border-border pt-4" disabled={disabled}>
      <legend className="text-xs font-medium text-foreground/80">{t("home.graphic.kind")}</legend>

      <div className="space-y-1.5">
        <label htmlFor="graphic-kind" className={PROJECT_LABEL_CLASS}>{t("home.graphic.what")}</label>
        <select
          id="graphic-kind"
          className={PROJECT_CONTROL_CLASS}
          value={kind}
          onChange={(event) => pickKind(event.target.value as GraphicSetKind)}
        >
          {GRAPHIC_KIND_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>{t(choice.label)}</option>
          ))}
        </select>
      </div>

      {presets.length > 0 && (
        <div className="space-y-1.5">
          <span className={PROJECT_LABEL_CLASS} id="graphic-preset-label">{t("home.graphic.platform")}</span>
          <div role="group" aria-labelledby="graphic-preset-label" className="grid gap-2 sm:grid-cols-2">
            {presets.map(({ preset, label, available }) => (
              <button
                key={preset.id}
                type="button"
                disabled={!available}
                aria-pressed={form.presetId === preset.id}
                aria-label={t("home.graphic.presetAria", { name: t(label), width: String(preset.width), height: String(preset.height), unavailable: available ? "" : t("home.graphic.unavailableSuffix"), unverified: preset.confidence === "unverified" ? t("home.graphic.unverifiedSuffix") : "" })}
                onClick={() => onChange({
                  presetId: preset.id,
                  graphicWidth: preset.width,
                  graphicHeight: preset.height,
                  // Resize the canvas-sized defaults, never an explicit custom/mixed set.
                  ...(kind === "banner_set" && form.frames.every((frame) => frame.width === form.graphicWidth && frame.height === form.graphicHeight)
                    ? { frames: form.frames.map((frame) => ({ ...frame, width: preset.width, height: preset.height })) }
                    : {}),
                })}
                className={
                  form.presetId === preset.id
                    ? "min-h-11 rounded-md border border-accent bg-accent-soft px-3 py-2 text-left text-xs text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    : "min-h-11 rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                <span className="flex items-center gap-1">
                  <span className="flex-1 truncate">{t(label)}</span>
                  {preset.confidence === "unverified" && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("home.graphic.unverified")}</span>
                  )}
                </span>
                <span className="font-mono text-[10px] text-foreground/70">{preset.width}×{preset.height}</span>
                {!available && (
                  <span className="block text-[10px] text-muted-foreground">{t("home.graphic.tooSmall")}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {multiFrame && (
        <div className="space-y-1.5">
          <label htmlFor="graphic-frame-count" className={PROJECT_LABEL_CLASS}>{t("home.graphic.count")}</label>
          <Input
            id="graphic-frame-count"
            type="number"
            inputMode="numeric"
            min={GRAPHIC_FRAME_COUNT_LIMIT.minimum}
            max={GRAPHIC_FRAME_COUNT_LIMIT.maximum}
            step={1}
            value={form.frameCount}
            onChange={(event) => pickFrameCount(event.target.valueAsNumber)}
          />
          <p className="text-xs text-muted-foreground">{t("home.graphic.countHint")}</p>
        </div>
      )}

      {kind === "banner_set" && (
        <div className="space-y-2">
          <span className={PROJECT_LABEL_CLASS} id="graphic-frames-label">{t("home.graphic.frameSizes")}</span>
          <ul aria-labelledby="graphic-frames-label" className="space-y-2">
            {form.frames.map((frame, index) => (
              <li key={index} className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">
                <Input
                  type="number"
                  min={320}
                  max={4096}
                  step={1}
                  value={frame.width}
                  aria-label={t("home.graphic.frameWidth", { count: index + 1 })}
                  onChange={(event) => onChange({
                    frames: form.frames.map((item, at) => at === index ? { ...item, width: event.target.valueAsNumber } : item),
                  })}
                />
                <Input
                  type="number"
                  min={240}
                  max={16_384}
                  step={1}
                  value={frame.height}
                  aria-label={t("home.graphic.frameHeight", { count: index + 1 })}
                  onChange={(event) => onChange({
                    frames: form.frames.map((item, at) => at === index ? { ...item, height: event.target.valueAsNumber } : item),
                  })}
                />
                <Input
                  value={frame.label}
                  maxLength={80}
                  placeholder={t("home.graphic.framePlaceholder")}
                  aria-label={t("home.graphic.frameName", { count: index + 1 })}
                  onChange={(event) => onChange({
                    frames: form.frames.map((item, at) => at === index ? { ...item, label: event.target.value } : item),
                  })}
                />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("home.graphic.frameHint")}</p>
        </div>
      )}

      {kind === "product_detail" && (
        <div className="space-y-3">
          <span className={PROJECT_LABEL_CLASS} id="detail-brief-label">{t("home.graphic.detailBrief")}</span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("home.graphic.detailHint")}
          </p>
          <ul aria-labelledby="detail-brief-label" className="space-y-3">
            {DETAIL_BRIEF_FIELDS.map((field) => {
              const value = form.detailBrief[field.key] ?? "";
              return (
                <li key={field.key} className="space-y-1">
                  <label htmlFor={`detail-brief-${field.key}`} className={PROJECT_LABEL_CLASS}>{t(field.label)}</label>
                  <textarea
                    id={`detail-brief-${field.key}`}
                    rows={2}
                    maxLength={DETAIL_BRIEF_MAX_LENGTH}
                    value={value}
                    aria-describedby={`detail-brief-${field.key}-hint`}
                    onChange={(event) => onChange({
                      detailBrief: { ...form.detailBrief, [field.key]: event.target.value },
                    })}
                    className="w-full rounded-md border border-input bg-background p-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p id={`detail-brief-${field.key}-hint`} className="text-pretty break-keep text-xs text-muted-foreground">
                    {t(field.hint)} ({value.length}/{DETAIL_BRIEF_MAX_LENGTH})
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
