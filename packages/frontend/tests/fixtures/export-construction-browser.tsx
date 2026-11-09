import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootstrapApiAuthority } from "../../src/api/client";
import { useLocaleStore, type Locale } from "../../src/i18n/locale";
import { t } from "../../src/i18n/t";
import ExportMenu from "../../src/components/export/ExportMenu";
import ToastContainer from "../../src/components/errors/BackendCrashToast";

declare global {
  var exportConstructionTest: {
    mount(locale: Locale): Promise<void>;
    labels(): { export: string; sheet: string; gif: string; missing: string; tooLarge: string };
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("export_construction_fixture_root_missing");
const root = createRoot(container);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});
const project = "export-construction";
const unexpectedAction = () => { throw new Error("unexpected_export_action"); };

globalThis.exportConstructionTest = {
  labels: () => ({
    export: t("export.title"),
    sheet: t("export.format.construction_svg"),
    gif: t("export.format.construction_gif"),
    missing: t("export.disabled.construction_missing"),
    tooLarge: t("export.construction.too_large"),
  }),
  async mount(locale) {
    await bootstrapApiAuthority();
    useLocaleStore.setState({ locale });
    const settled = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { unsubscribe(); reject(new Error("export_construction_queries_timeout")); }, 5000);
      const unsubscribe = client.getQueryCache().subscribe(() => {
        const queries = [client.getQueryState(["project", project, "files"]), client.getQueryState(["project", project, "exports"])];
        if (queries.some(query => query === undefined || query.status === "pending")) return;
        clearTimeout(timer);
        unsubscribe();
        if (queries.some(query => query?.status !== "success")) reject(new Error("export_construction_query_failed"));
        else resolve();
      });
    });
    settled.catch(() => undefined);
    flushSync(() => root.render(
      <QueryClientProvider client={client}>
        <div className="flex min-h-screen min-w-0 flex-col bg-background text-foreground">
          <header className="flex justify-end border-b border-border p-3">
            <ExportMenu projectId={project} projectType="logo" projectOptionsJson={null}
              qualityGate={null} onOpenQuality={unexpectedAction} />
          </header>
          <main className="min-h-48 flex-1 bg-muted/40" />
          <ToastContainer />
        </div>
      </QueryClientProvider>,
    ));
    await settled;
  },
};
