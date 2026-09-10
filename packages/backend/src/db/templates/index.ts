import type { GraphicCanvasV1, GraphicSetV1, ProjectType } from "@bg/shared";
import { renderGraphic } from "./graphic";
import { renderPrototype } from "./prototype";
import { renderSlideDeck, type SlideDeckOptions } from "./slide-deck";

export interface TemplateContext {
  readonly name: string;
  readonly type: ProjectType;
  readonly options?: SlideDeckOptions & {
    readonly graphic_canvas?: GraphicCanvasV1 | null;
    readonly graphic_set?: GraphicSetV1;
  };
}

export function renderInitialArtifact(ctx: TemplateContext): string {
  switch (ctx.type) {
    case "slide_deck":
      return renderSlideDeck(ctx.name, ctx.options ?? {});
    case "graphic": {
      const canvas = ctx.options?.graphic_canvas;
      if (canvas === undefined || canvas === null) {
        throw new TypeError("Graphic template requires graphic_canvas");
      }
      return renderGraphic(ctx.name, canvas, ctx.options?.graphic_set);
    }
    case "prototype":
    case "from_template":
    case "other":
      return renderPrototype(ctx.name);
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
