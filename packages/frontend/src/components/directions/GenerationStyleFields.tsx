import { useT } from "@/i18n/t";
import { COPY_TONE_PRESETS, IMAGE_STYLE_PRESETS, IMAGE_PROMPT_RECIPES, IMAGE_RECIPE_GROUPS, parseGenerationStyle, type GenerationStyle } from "@bg/shared";

export function GenerationStyleFields({ value, onChange, disabled }: {
  readonly value: GenerationStyle;
  readonly onChange: (value: GenerationStyle) => void;
  readonly disabled: boolean;
}) {
  const t = useT();
  return (
    <fieldset disabled={disabled} className="mt-6 rounded-xl border border-border bg-card p-4 text-left sm:p-5">
      <legend className="px-2 text-sm font-semibold">{t("directions.style.legend")}</legend>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t("directions.style.description")}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="direction-image-style" className="text-sm font-medium">{t("directions.style.preset")}</label>
          <select id="direction-image-style" aria-describedby="direction-image-style-description" value={value.image_style}
            onChange={(event) => onChange(parseGenerationStyle({ ...value, image_style: event.target.value }))}
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
            {(Object.keys(IMAGE_STYLE_PRESETS) as (keyof typeof IMAGE_STYLE_PRESETS)[]).map((key) => <option key={key} value={key}>{t(`directions.image.${key}.label`)}</option>)}
          </select>
          <p id="direction-image-style-description" className="mt-2 min-h-10 text-xs leading-relaxed text-muted-foreground">{t(`directions.image.${value.image_style}.description`)}</p>
        </div>
        <div>
          <label htmlFor="direction-copy-tone" className="text-sm font-medium">{t("directions.style.tone")}</label>
          <select id="direction-copy-tone" aria-describedby="direction-copy-tone-example" value={value.copy_tone}
            onChange={(event) => onChange(parseGenerationStyle({ ...value, copy_tone: event.target.value }))}
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
            {(Object.keys(COPY_TONE_PRESETS) as (keyof typeof COPY_TONE_PRESETS)[]).map((key) => <option key={key} value={key}>{t(`directions.tone.${key}.label`)}</option>)}
          </select>
          <p id="direction-copy-tone-example" className="mt-2 min-h-10 text-xs leading-relaxed text-muted-foreground">{t("directions.style.example", { name: t(`directions.tone.${value.copy_tone}.example`) })}</p>
        </div>
      </div>
      <div className="mt-5">
        <label htmlFor="direction-image-recipe" className="text-sm font-medium">{t("directions.style.recipe")}</label>
        <select id="direction-image-recipe" aria-describedby="direction-image-recipe-description" value={value.image_recipe ?? "auto"}
          onChange={event => onChange(parseGenerationStyle({ ...value, image_recipe: event.target.value }))}
          className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
          <option value="auto">{t("directions.style.auto")}</option>
          {(Object.keys(IMAGE_RECIPE_GROUPS) as (keyof typeof IMAGE_RECIPE_GROUPS)[]).map((group) => <optgroup key={group} label={t(`directions.group.${group}`)}>{(Object.keys(IMAGE_PROMPT_RECIPES) as (keyof typeof IMAGE_PROMPT_RECIPES)[]).filter((key) => IMAGE_PROMPT_RECIPES[key].group === group).map((key) => <option key={key} value={key}>{t(`directions.recipe.${key}`)}</option>)}</optgroup>)}
        </select>
        <p id="direction-image-recipe-description" className="mt-2 text-xs leading-relaxed text-muted-foreground">{!value.image_recipe || value.image_recipe === "auto" ? t("directions.style.autoDescription") : t("directions.style.recipeDescription", { name: t(`directions.recipe.${value.image_recipe}`) })} {t("directions.style.recipeNote")}</p>
      </div>
    </fieldset>
  );
}
