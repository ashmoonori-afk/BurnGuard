import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootstrapApiAuthority } from "../../src/api/client";
import PreviewIframe from "../../src/components/systems/PreviewIframe";

export const NORTHVALE_PREVIEWS = [
  "colors-neutrals.html", "colors-ramps.html", "colors-charts.html", "brand-icons.html",
] as const;

declare global {
  var northvalePreviewTest: {
    mount(dark: boolean): Promise<void>;
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("northvale_fixture_root_missing");
const root = createRoot(container);
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

globalThis.northvalePreviewTest = {
  async mount(dark) {
    await bootstrapApiAuthority();
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // The capture listener is armed before React can insert or load any frame.
    await new Promise<void>((resolve, reject) => {
      const loaded = new Set<string>();
      const cleanup = () => { clearTimeout(deadline); container.removeEventListener("load", onLoad, true); };
      const onLoad = (event: Event) => {
        if (!(event.target instanceof HTMLIFrameElement)) return;
        const document = event.target.contentDocument;
        if (!document || document.URL === "about:blank") return;
        loaded.add(event.target.title);
        if (loaded.size === NORTHVALE_PREVIEWS.length) { cleanup(); resolve(); }
      };
      const deadline = setTimeout(() => { cleanup(); reject(new Error("northvale_frame_load_missing")); }, 5000);
      container.addEventListener("load", onLoad, true);
      flushSync(() => root.render(
        <QueryClientProvider client={client}>
          <main className="grid gap-4 bg-background p-4 text-foreground">
            {NORTHVALE_PREVIEWS.map(name => <section key={name}>
              <PreviewIframe systemId="northvale-capital" path={`preview/${name}`} title={name} />
            </section>)}
          </main>
        </QueryClientProvider>,
      ));
    });
    await Promise.all([...container.querySelectorAll("iframe")].map(frame => frame.contentDocument?.fonts.ready));
  },
};
