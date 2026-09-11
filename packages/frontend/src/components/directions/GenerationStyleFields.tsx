import { COPY_TONE_PRESETS, IMAGE_STYLE_PRESETS, IMAGE_PROMPT_RECIPES, IMAGE_RECIPE_GROUPS, parseGenerationStyle, type GenerationStyle } from "@bg/shared";

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
      <div className="mt-5">
        <label htmlFor="direction-image-recipe" className="text-sm font-medium">이미지 용도</label>
        <select id="direction-image-recipe" aria-describedby="direction-image-recipe-description" value={value.image_recipe ?? "auto"}
          onChange={event => onChange(parseGenerationStyle({ ...value, image_recipe: event.target.value }))}
          className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
          <option value="auto">자동 · 요청과 각 이미지의 역할에 맞게</option>
          {Object.entries(IMAGE_RECIPE_GROUPS).map(([group, label]) => <optgroup key={group} label={label}>{Object.entries(IMAGE_PROMPT_RECIPES).filter(([, recipe]) => recipe.group === group).map(([key, recipe]) => <option key={key} value={key}>{recipe.label}</option>)}</optgroup>)}
        </select>
        <p id="direction-image-recipe-description" className="mt-2 text-xs leading-relaxed text-muted-foreground">{!value.image_recipe || value.image_recipe === "auto" ? "13개 분야에서 이미지마다 필요한 구도·소재·검수 기준을 골라 적용해요." : `${IMAGE_PROMPT_RECIPES[value.image_recipe].label}에 맞는 구도·소재·검수 기준을 적용해요.`} 위의 스타일과 함께 저장되며, 기존 이미지를 자동으로 다시 만들지는 않아요.</p>
      </div>
    </fieldset>
  );
}
