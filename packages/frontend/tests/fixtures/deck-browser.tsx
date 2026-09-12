import { createRoot } from "react-dom/client";
import { bootstrapApiAuthority } from "../../src/api/client";
import { embedCanvasImages } from "../../src/lib/canvas-images";
import { buildSandboxedArtifactSrcDoc } from "../../src/components/canvas/frame-bridge";
import PresentOverlay from "../../src/components/present/PresentOverlay";

const root = createRoot(document.body.appendChild(document.createElement("main")));
Object.assign(globalThis, { deckTest: {
  bootstrapApiAuthority,
  embedCanvasImages,
  async canvas(html: string, url: string) {
    const embedded = await embedCanvasImages(html, url, new AbortController().signal);
    await new Promise<void>((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.title = "test-canvas";
      frame.setAttribute("sandbox", "allow-scripts");
      const timer = setTimeout(() => reject(new Error("frame_load_timeout")), 10000);
      frame.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
      frame.srcdoc = buildSandboxedArtifactSrcDoc(embedded, url);
      document.querySelector('iframe[title="test-canvas"]')?.remove();
      document.body.append(frame);
    });
    return embedded;
  },
  present(src: string) {
    return new Promise<void>((resolve, reject) => {
      const loaded = (event: Event) => {
        if (!(event.target instanceof HTMLIFrameElement) || !event.target.srcdoc) return;
        clearTimeout(timer); document.removeEventListener("load", loaded, true); resolve();
      };
      const timer = setTimeout(() => { document.removeEventListener("load", loaded, true); reject(new Error("presentation_load_timeout")); }, 10000);
      document.addEventListener("load", loaded, true);
      root.render(<PresentOverlay src={src} onClose={() => root.render(null)} />);
    });
  },
} });
