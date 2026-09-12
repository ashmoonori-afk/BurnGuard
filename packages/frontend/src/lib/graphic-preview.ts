import type { GraphicCanvasV1 } from "@bg/shared";

export type GraphicPreviewSize = {
  readonly width: number;
  readonly height: number;
};

export type GraphicPreviewFit = {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly renderedWidth: number;
  readonly renderedHeight: number;
};

export function buildGraphicPreviewInjection(canvas: GraphicCanvasV1): string {
  const config = JSON.stringify(canvas);
  return `<style data-bg-graphic-preview-style>
html[data-bg-graphic-preview="fit"] { width: 100% !important; height: 100% !important; overflow: hidden !important; background: #f1f3f5 !important; }
html[data-bg-graphic-preview="fit"] > body { position: absolute !important; inset: 0 auto auto 0 !important; margin: 0 !important; width: var(--bg-graphic-canvas-width) !important; height: var(--bg-graphic-canvas-height) !important; overflow: hidden !important; transform: translate(var(--bg-graphic-preview-x,0px), var(--bg-graphic-preview-y,0px)) scale(var(--bg-graphic-preview-scale,1)) !important; transform-origin: top left !important; }
html[data-bg-graphic-preview="fit"] [data-graphic-artboard] { contain: layout paint !important; }
</style><script data-bg-graphic-preview-runtime>(function(){const canvas=${config};const applyFit=()=>{const scale=Math.min(innerWidth/canvas.width,innerHeight/canvas.height,1);const x=(innerWidth-canvas.width*scale)/2;const y=(innerHeight-canvas.height*scale)/2;const root=document.documentElement;root.dataset.bgGraphicPreview="fit";root.style.setProperty("--bg-graphic-canvas-width",canvas.width+"px");root.style.setProperty("--bg-graphic-canvas-height",canvas.height+"px");root.style.setProperty("--bg-graphic-preview-scale",String(scale));root.style.setProperty("--bg-graphic-preview-x",x+"px");root.style.setProperty("--bg-graphic-preview-y",y+"px")};const install=()=>{window.addEventListener("resize",applyFit);applyFit();requestAnimationFrame(applyFit)};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",install,{once:true})}else{install()}})();<\/script>`;
}

export function computeGraphicPreviewFit(
  container: GraphicPreviewSize,
  canvas: GraphicPreviewSize,
): GraphicPreviewFit {
  const scale = Math.min(
    container.width / canvas.width,
    container.height / canvas.height,
    1,
  );
  const renderedWidth = canvas.width * scale;
  const renderedHeight = canvas.height * scale;
  return {
    scale,
    x: (container.width - renderedWidth) / 2,
    y: (container.height - renderedHeight) / 2,
    renderedWidth,
    renderedHeight,
  };
}
