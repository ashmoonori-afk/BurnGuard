import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { computeGraphicPreviewFit } from "../src/lib/graphic-preview";
import { parseProjectGraphicCanvas } from "../src/lib/graphic-project";

const GRAPHIC_HTML = "<!doctype html><html><head><title>Graphic</title></head><body><main data-graphic-artboard><h1 data-bg-node-id=title>Title</h1></main></body></html>";
const BASE_HREF = "http://local/api/projects/p/fs/index.html";

describe("graphic preview fit", () => {
  test("a zero-size initial iframe refits after its first layout frame", () => {
    const source = buildSandboxedArtifactSrcDoc(GRAPHIC_HTML, BASE_HREF, {
      graphicCanvas: { schema_version: 1, width: 640, height: 480 },
    });
    const runtime = source.match(/<script data-bg-graphic-preview-runtime>([\s\S]*?)<\/script>/u)?.[1];
    if (!runtime) throw new Error("Graphic runtime missing");
    const frames: Array<() => void> = [];
    const properties = new Map<string, string>();
    const context = {
      innerWidth: 0, innerHeight: 0,
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      window: { addEventListener() {} },
      document: { readyState: "complete", documentElement: {
        dataset: {}, style: { setProperty: (name: string, value: string) => properties.set(name, value) },
      } },
    };
    runInNewContext(runtime, context);
    expect(frames).toHaveLength(1);
    context.innerWidth = 1076;
    context.innerHeight = 685;
    frames[0]?.();
    expect(properties.get("--bg-graphic-preview-scale")).toBe("1");
    expect(properties.get("--bg-graphic-preview-x")).toBe("218px");
    expect(properties.get("--bg-graphic-preview-y")).toBe("102.5px");
  });

  test.each([
    [{ width: 375, height: 315 }, { width: 1200, height: 628 }, { scale: 0.3125, x: 0, y: 59.375, renderedWidth: 375, renderedHeight: 196.25 }],
    [{ width: 375, height: 315 }, { width: 1080, height: 1920 }, { scale: 0.1640625, x: 98.90625, y: 0, renderedWidth: 177.1875, renderedHeight: 315 }],
    [{ width: 768, height: 500 }, { width: 1080, height: 1080 }, { scale: 0.46296296296296297, x: 134, y: 0, renderedWidth: 500, renderedHeight: 500 }],
    [{ width: 1280, height: 900 }, { width: 320, height: 240 }, { scale: 1, x: 480, y: 330, renderedWidth: 320, renderedHeight: 240 }],
  ] as const)("Given container and canvas When fitted Then the whole artboard is centered without upscale", (container, canvas, expected) => {
    expect(computeGraphicPreviewFit(container, canvas)).toEqual(expected);
  });

  test("Given strict graphic dimensions When sandboxed Then fit runtime is bounded and coordinate-coherent", () => {
    const sourceHash = createHash("sha256").update(GRAPHIC_HTML).digest("hex");
    const srcDoc = buildSandboxedArtifactSrcDoc(GRAPHIC_HTML, BASE_HREF, {
      graphicCanvas: { schema_version: 1, width: 1200, height: 628 },
    });
    const runtime = srcDoc.match(/<script data-bg-graphic-preview-runtime>([\s\S]*?)<\/script>/u)?.[1] ?? "";

    expect(createHash("sha256").update(GRAPHIC_HTML).digest("hex")).toBe(sourceHash);
    expect(runtime).toContain('const canvas={"schema_version":1,"width":1200,"height":628}');
    const listener = 'window.addEventListener("resize",applyFit)';
    expect(runtime).toContain(listener);
    expect(runtime.match(/addEventListener\("resize"/gu)).toHaveLength(1);
    expect(runtime.indexOf(listener)).toBeLessThan(runtime.indexOf("applyFit()"));
    expect(runtime).not.toContain("document.body");
    expect(runtime).not.toContain("setInterval");
    expect(runtime).not.toContain("setTimeout");
    expect(srcDoc).toContain("transform: translate(var(--bg-graphic-preview-x,0px), var(--bg-graphic-preview-y,0px)) scale(var(--bg-graphic-preview-scale,1)) !important;");
    expect(srcDoc).toContain("getBoundingClientRect");
    expect(srcDoc).toContain("document.elementFromPoint");
    expect(srcDoc).toContain('data-bg-graphic-preview="fit"');
    expect(srcDoc).toContain("--bg-graphic-preview-scale");
  });

  test("Given non-graphic sandbox options When built Then prior output stays byte-identical", () => {
    expect(buildSandboxedArtifactSrcDoc(GRAPHIC_HTML, BASE_HREF, {})).toBe(
      buildSandboxedArtifactSrcDoc(GRAPHIC_HTML, BASE_HREF),
    );
    expect(buildSandboxedArtifactSrcDoc(GRAPHIC_HTML, BASE_HREF)).not.toContain("data-bg-graphic-preview-runtime");
  });

  test("Given malformed stored dimensions When parsed Then no preview runtime can be enabled", () => {
    expect(parseProjectGraphicCanvas("graphic", JSON.stringify({
      graphic_canvas: {
        schema_version: 1,
        width: "</script><script>globalThis.breakout=true</script>",
        height: 628,
      },
    }))).toBeNull();
    expect(parseProjectGraphicCanvas("prototype", JSON.stringify({
      graphic_canvas: { schema_version: 1, width: 1200, height: 628 },
    }))).toBeNull();
  });
});
