import { IMAGE_PROMPT_RECIPES, type ImageRecipe } from "@bg/shared";
import type { Deliverable } from "./prompt-task-presets";

/** A logo is a flat vector mark and a diagram is authored SVG; neither chooses from the photographic catalog. */
const CATALOG_FREE_DELIVERABLES: ReadonlySet<Deliverable> = new Set(["logo", "diagram"]);

export const IMAGE_PRODUCTION_RULES = `## BurnGuard image production
Creation/redesign includes deciding each section's visual needs and producing appropriate imagery without a separate image request. Reuse suitable supplied assets; for missing photographs, product scenes or explicitly requested illustrations, invoke the available image tool and attach usable output. Prompts, empty slots and CSS decoration do not complete this step. Respect text-only requests; do not force images into clear factual tables/controls or regenerate them during unrelated edits. User requirements and brand assets override recipe defaults; saved style controls treatment.
For app introductions/manuals, inspect available source, routes and assets, then faithfully recreate the interface in editable code or run and capture it with available tools. Do not skip useful screens because no screenshot was attached. Label source-based recreations and sample data; only call a rendered app capture an actual screenshot. Ask for a specific screenshot only when source, assets and accessible rendering cannot establish the required screen/state. Never invent features or evidence.
For each placement, write a concrete image brief: intended message and audience; subject and visible action; distinguishing features to preserve; camera distance and viewpoint; surrounding space and scale; light direction and softness; material behavior; palette; target aspect ratio, crop and text-safe area. Add only details that affect the result. Avoid long adjective lists or combining incompatible aesthetics.
Use Codex's available image-generation tool for new raster imagery. Recipes do not select a provider or assert a model is available. Reuse appropriate supplied assets; report unavailable generation honestly. Working websites, controls, factual charts, maps, tables and long text stay in their native editable form. Use BurnGuard SVG charts for data. Follow the existing provider-specific map restrictions and supported embeds for real locations; an illustrative map is not geographic evidence.
Keep exact names, numbers and user-locked wording intact. Usually generate artwork without lettering and add copy through HTML/CSS; request baked-in text only when it is part of the commissioned artwork, then inspect every glyph. Do not invent endorsements, product capabilities, authentic documents, scientific measurements or proof from a generated picture.
For a series, lock identity, material and color behavior but assign a new content composition to each placement. Plan separate images for detail-page sections and match every output to its actual artboard. Preserve user-approved reference regions during edits and use the existing prompt-review flow for regeneration.
Write the page scaffold first and attach each successful image as it becomes available. Save usable local assets and retain their prompts in the project's existing image metadata. Apply the mandatory image and artboard verification below. Keep quality findings advisory for user-directed export.
Choose a recipe per asset from the catalog below, preferring photographic recipes unless the user asks for another treatment; use only relevant instructions and adapt the composition to the brief. The catalog is not a request to generate every example.`;

export function appendImageProduction(lines: string[], recipe: ImageRecipe = "auto", deliverable?: Deliverable): void {
  lines.push(IMAGE_PRODUCTION_RULES);
  if (deliverable !== undefined && CATALOG_FREE_DELIVERABLES.has(deliverable)) {
    lines.push(`The recipe catalog is omitted for a ${deliverable} deliverable; its skill above or below owns the image brief.`, "");
    return;
  }
  lines.push("<burnguard-image-recipes-v1>");
  const entries = recipe === "auto" ? Object.entries(IMAGE_PROMPT_RECIPES) : [[recipe, IMAGE_PROMPT_RECIPES[recipe]]] as const;
  for (const [id, entry] of entries) lines.push(`${id} | ${entry.label}: ${entry.prompt}`);
  lines.push("</burnguard-image-recipes-v1>", "");
}
