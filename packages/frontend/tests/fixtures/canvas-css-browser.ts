import { bootstrapApiAuthority } from "../../src/api/client";
import { buildSandboxedArtifactSrcDoc, openFrameExternalLink, subscribeFrameEvent } from "../../src/components/canvas/frame-bridge";
import { embedCanvasImages } from "../../src/lib/canvas-images";

Object.assign(globalThis, {
  canvasCssTest: {
    bootstrapApiAuthority,
    buildSandboxedArtifactSrcDoc,
    openFrameExternalLink,
    subscribeFrameEvent,
    embedCanvasImages,
  },
});
