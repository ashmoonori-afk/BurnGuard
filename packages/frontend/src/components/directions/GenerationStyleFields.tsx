import { COPY_TONE_PRESETS, IMAGE_STYLE_PRESETS, parseGenerationStyle, type GenerationStyle } from "@bg/shared";

export function GenerationStyleFields({ value, onChange, disabled }: {
  readonly value: GenerationStyle;
  readonly onChange: (value: GenerationStyle) => void;
  readonly disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="mt-6 rounded-xl border border-border bg-card p-4 text-left sm:p-5">
      <legend className="px-2 text-sm font-semibold">이미지와 문안</legend>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">구성과 별개로 이미지의 표현 방식과 문안의 말투를 정해요. 저장한 설정은 다음 생성·수정부터 적용돼요.</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="direction-image-style" className="text-sm font-medium">이미지 스타일 프리셋</label>
          <select id="direction-image-style" aria-describedby="direction-image-style-description" value={value.image_style}
            onChange={(event) => onChange(parseGenerationStyle({ ...value, image_style: event.target.value }))}
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
            {Object.entries(IMAGE_STYLE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
          </select>
          <p id="direction-image-style-description" className="mt-2 min-h-10 text-xs leading-relaxed text-muted-foreground">{IMAGE_STYLE_PRESETS[value.image_style].description}</p>
        </div>
        <div>
          <label htmlFor="direction-copy-tone" className="text-sm font-medium">문안 어투</label>
          <select id="direction-copy-tone" aria-describedby="direction-copy-tone-example" value={value.copy_tone}
            onChange={(event) => onChange(parseGenerationStyle({ ...value, copy_tone: event.target.value }))}
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
            {Object.entries(COPY_TONE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
          </select>
          <p id="direction-copy-tone-example" className="mt-2 min-h-10 text-xs leading-relaxed text-muted-foreground">예시 · {COPY_TONE_PRESETS[value.copy_tone].example}</p>
        </div>
      </div>
    </fieldset>
  );
}
