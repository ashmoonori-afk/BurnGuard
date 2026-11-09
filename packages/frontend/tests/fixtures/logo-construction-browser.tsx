import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootstrapApiAuthority } from "../../src/api/client";
import { useLocaleStore, type Locale } from "../../src/i18n/locale";
import { t } from "../../src/i18n/t";
import LogoConstructionCard from "../../src/components/logo/LogoConstructionCard";

declare global {
  var logoConstructionTest: {
    mount(locale: Locale): Promise<void>;
    labels(): { design: string; construction: string; replay: string; view: string };
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("logo_construction_fixture_root_missing");
const root = createRoot(container);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});
const project = "logo-construction";

globalThis.logoConstructionTest = {
  labels: () => ({
    design: t("logo.construction.design"),
    construction: t("logo.construction.drawing"),
    replay: t("logo.construction.replay"),
    view: t("logo.construction.view"),
  }),
  async mount(locale) {
    await bootstrapApiAuthority();
    useLocaleStore.setState({ locale });
    const settled = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { unsubscribe(); reject(new Error("logo_construction_queries_timeout")); }, 5000);
      const unsubscribe = client.getQueryCache().subscribe(() => {
        // The query keyed before the file listing arrived stays disabled; wait for the one that ran.
        const ran = client.getQueryCache().findAll({ queryKey: ["projects", project, "logo-geometry"] })
          .some(query => query.state.fetchStatus === "idle" && query.state.status !== "pending");
        if (!ran) return;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
    settled.catch(() => undefined);
    flushSync(() => root.render(
      <QueryClientProvider client={client}>
        <div className="flex min-h-screen min-w-0 flex-col bg-background text-foreground">
          <LogoConstructionCard projectId={project} />
          <main className="min-h-48 flex-1 bg-muted/40" />
        </div>
      </QueryClientProvider>,
    ));
    await settled;
  },
};
