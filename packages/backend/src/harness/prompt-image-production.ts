import { IMAGE_PROMPT_RECIPES, type ImageRecipe } from "@bg/shared";

export const IMAGE_PRODUCTION_RULES = `## BurnGuard image production
Use these rules when an image is needed, not as a reason to regenerate images during an unrelated edit. A recipe controls the image's job; the saved style controls its treatment. Explicit user requirements and approved brand assets take precedence over a recipe's defaults.
For each placement, write a concrete image brief: intended message and audience; subject and visible action; distinguishing features to preserve; camera distance and viewpoint; surrounding space and scale; light direction and softness; material behavior; palette; target aspect ratio, crop and text-safe area. Add only details that affect the result. Avoid long adjective lists or combining incompatible aesthetics.
Use Codex's available image-generation tool for new raster imagery. Recipes do not select a provider or assert a model is available. Reuse appropriate supplied assets; report unavailable generation honestly. Working websites, controls, factual charts, maps, tables and long text stay in their native editable form. Use BurnGuard SVG charts for data. Follow the existing provider-specific map restrictions and supported embeds for real locations; an illustrative map is not geographic evidence.
Keep exact names, numbers and user-locked wording intact. Usually generate artwork without lettering and add copy through HTML/CSS; request baked-in text only when it is part of the commissioned artwork, then inspect every glyph. Do not invent endorsements, product capabilities, authentic documents, scientific measurements or proof from a generated picture.
For a series, lock identity, material and color behavior but assign a new content composition to each placement. Cropping or recoloring the same content image is still a duplicate. Plan separate images for detail-page sections and match every output to its actual artboard. Preserve user-approved reference regions during edits and use the existing prompt-review flow for regeneration.
Write the page scaffold first and attach each successful image as it becomes available. Save usable local assets and retain their prompts in the project's existing image metadata. Check loading, crop, anatomy, repeated subjects, perspective, lettering and brand consistency at the final display size. State which visual checks were performed; do not claim that a text inspection proves an image is correct. Keep quality findings advisory for user-directed export.
Choose a recipe per asset from the catalog below; use only relevant instructions and adapt the composition to the brief. The catalog is not a request to generate every example.`;

export function appendImageProduction(lines: string[], recipe: ImageRecipe = "auto"): void {
  lines.push(IMAGE_PRODUCTION_RULES);
  lines.push("<burnguard-image-recipes-v1>");
  const entries = recipe === "auto" ? Object.entries(IMAGE_PROMPT_RECIPES) : [[recipe, IMAGE_PROMPT_RECIPES[recipe]]] as const;
  for (const [id, entry] of entries) lines.push(`${id} | ${entry.label}: ${entry.prompt}`);
  lines.push("</burnguard-image-recipes-v1>", "");
}
