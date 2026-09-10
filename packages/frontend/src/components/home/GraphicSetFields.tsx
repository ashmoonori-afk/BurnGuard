import type { GraphicFrameV1, GraphicSetKind } from "@bg/shared";
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
      <legend className="text-xs font-medium text-foreground/80">그래픽 종류</legend>

      <div className="space-y-1.5">
        <label htmlFor="graphic-kind" className={PROJECT_LABEL_CLASS}>무엇을 만드나요</label>
        <select
          id="graphic-kind"
          className={PROJECT_CONTROL_CLASS}
          value={kind}
          onChange={(event) => pickKind(event.target.value as GraphicSetKind)}
        >
          {GRAPHIC_KIND_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </select>
      </div>

      {presets.length > 0 && (
        <div className="space-y-1.5">
          <span className={PROJECT_LABEL_CLASS} id="graphic-preset-label">플랫폼 규격</span>
          <div role="group" aria-labelledby="graphic-preset-label" className="grid gap-2 sm:grid-cols-2">
            {presets.map(({ preset, available }) => (
              <button
                key={preset.id}
                type="button"
                disabled={!available}
                aria-pressed={form.presetId === preset.id}
                aria-label={`${preset.placement} ${preset.width}×${preset.height}${available ? "" : " 사용 불가"}${preset.confidence === "unverified" ? " 미확인 규격" : ""}`}
                onClick={() => onChange({
                  presetId: preset.id,
                  graphicWidth: preset.width,
                  graphicHeight: preset.height,
                })}
                className={
                  form.presetId === preset.id
                    ? "min-h-11 rounded-md border border-accent bg-accent-soft px-3 py-2 text-left text-xs text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    : "min-h-11 rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                <span className="flex items-center gap-1">
                  <span className="flex-1 truncate">{preset.placement}</span>
                  {preset.confidence === "unverified" && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">미확인</span>
                  )}
                </span>
                <span className="font-mono text-[10px] text-foreground/70">{preset.width}×{preset.height}</span>
                {!available && (
                  <span className="block text-[10px] text-muted-foreground">최소 320×240보다 작아 만들 수 없어요</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {multiFrame && (
        <div className="space-y-1.5">
          <label htmlFor="graphic-frame-count" className={PROJECT_LABEL_CLASS}>장수</label>
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
          <p className="text-xs text-muted-foreground">1~40장까지 만들 수 있어요.</p>
        </div>
      )}

      {kind === "banner_set" && (
        <div className="space-y-2">
          <span className={PROJECT_LABEL_CLASS} id="graphic-frames-label">프레임별 크기</span>
          <ul aria-labelledby="graphic-frames-label" className="space-y-2">
            {form.frames.map((frame, index) => (
              <li key={index} className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">
                <Input
                  type="number"
                  min={320}
                  max={4096}
                  step={1}
                  value={frame.width}
                  aria-label={`${index + 1}번 프레임 너비`}
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
                  aria-label={`${index + 1}번 프레임 높이`}
                  onChange={(event) => onChange({
                    frames: form.frames.map((item, at) => at === index ? { ...item, height: event.target.valueAsNumber } : item),
                  })}
                />
                <Input
                  value={frame.label}
                  maxLength={80}
                  placeholder="예: 가로형 배너"
                  aria-label={`${index + 1}번 프레임 이름`}
                  onChange={(event) => onChange({
                    frames: form.frames.map((item, at) => at === index ? { ...item, label: event.target.value } : item),
                  })}
                />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">크기가 서로 다르면 PDF 대신 PNG 묶음으로 내보내요.</p>
        </div>
      )}

      {kind === "product_detail" && (
        <div className="space-y-3">
          <span className={PROJECT_LABEL_CLASS} id="detail-brief-label">상세페이지 브리프</span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            편하게 적어 주세요. AI가 핵심을 유지하며 제목과 본문으로 요약·윤문하고, 각 섹션에 맞는 이미지를 배치해요. 없는 수치나 후기는 만들지 않아요.
          </p>
          <ul aria-labelledby="detail-brief-label" className="space-y-3">
            {DETAIL_BRIEF_FIELDS.map((field) => {
              const value = form.detailBrief[field.key] ?? "";
              return (
                <li key={field.key} className="space-y-1">
                  <label htmlFor={`detail-brief-${field.key}`} className={PROJECT_LABEL_CLASS}>{field.label}</label>
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
                    {field.hint} ({value.length}/{DETAIL_BRIEF_MAX_LENGTH})
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
