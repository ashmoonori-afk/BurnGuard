import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootstrapApiAuthority } from "../../src/api/client";
import { useLocaleStore, type Locale } from "../../src/i18n/locale";
import { t } from "../../src/i18n/t";
import { mockProject } from "../../src/mocks/project-session";
import ProjectTopBar from "../../src/components/project/ProjectTopBar";
import CanvasTopBar from "../../src/components/canvas/CanvasTopBar";
import ColorPalette from "../../src/components/canvas/ColorPalette";
import ArtifactHistory from "../../src/components/canvas/ArtifactHistory";
import AlternativeCompare from "../../src/components/alternatives/AlternativeCompare";

declare global {
  var workspaceControlsTest: {
    mount(locale: Locale): Promise<void>;
    labels(): { export: string; recent: string; tools: string; more: string };
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("workspace_fixture_root_missing");
const root = createRoot(container);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});
const project = {
  ...mockProject,
  id: "workspace-controls",
  name: "Quarterly product review with a deliberately long fixed project title",
};
const unexpectedAction = () => { throw new Error("unexpected_workspace_action"); };
const unexpectedAsyncAction = async () => { unexpectedAction(); };

globalThis.workspaceControlsTest = {
  labels: () => ({
    export: t("export.title"),
    recent: t("export.recent"),
    tools: t("canvas.toolbar.tools"),
    more: t("canvas.toolbar.more"),
  }),
  async mount(locale) {
    await bootstrapApiAuthority();
    useLocaleStore.setState({ locale });
    const queriesReady = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { unsubscribe(); reject(new Error("workspace_queries_timeout")); }, 5000);
      const unsubscribe = client.getQueryCache().subscribe(() => {
        const queries = [
          client.getQueryState(["projects", project.id, "instructions"]),
          client.getQueryState(["project", project.id, "exports"]),
        ];
        if (queries.some(query => query === undefined || query.fetchStatus !== "idle" || query.status === "pending")) return;
        clearTimeout(timer);
        unsubscribe();
        if (queries.some(query => query?.status !== "success")) reject(new Error("workspace_query_failed"));
        else resolve();
      });
    });
    queriesReady.catch(() => undefined);
    flushSync(() => root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <div className="flex min-h-screen min-w-0 flex-col bg-background text-foreground">
            <ProjectTopBar project={project} canPresent onPresent={unexpectedAction}
              qualityGate={null} onOpenQuality={unexpectedAction}
              onToggleChat={unexpectedAction} onFigmaImported={unexpectedAsyncAction}
              artifactRevision={0} artifactDigest={"a".repeat(64)} />
            <section data-canvas-toolbar>
              <CanvasTopBar mode={null} onModeChange={unexpectedAction} onRefresh={unexpectedAction}
                devicePreset="fit" onDevicePresetChange={unexpectedAction}
                canUndo onUndo={unexpectedAction}
                colorPalette={<ColorPalette projectId={project.id} relPath="deck.html" refreshKey="fixed"
                  disabled={false} onSaved={unexpectedAction} />}
                historyTools={<div className="flex items-center gap-1">
                  <AlternativeCompare state={undefined} disabled={false} generating={false} submitting={false}
                    cancelling={false} promotingId={null} deletingId={null}
                    onGenerate={unexpectedAsyncAction} onPromote={unexpectedAsyncAction}
                    onDelete={unexpectedAsyncAction} onCancel={unexpectedAsyncAction} />
                  <ArtifactHistory projectId={project.id} history={undefined} disabled={false}
                    onRestore={unexpectedAsyncAction} onReapply={unexpectedAsyncAction}
                    onRecoverDraft={unexpectedAsyncAction} />
                </div>} />
            </section>
            <main className="min-h-48 flex-1 bg-muted/40">
              <button type="button" data-outside-target className="m-4 rounded-control border border-border p-3">
                Outside interaction target
              </button>
            </main>
          </div>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
    await queriesReady;
    await document.fonts.ready;
    await new Promise<void>((resolve, reject) => {
      const toolbar = document.querySelector("[data-measure-tick]");
      if (!toolbar) { reject(new Error("toolbar_missing")); return; }
      if (Number(toolbar.getAttribute("data-measure-tick")) > 0) { resolve(); return; }
      const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error("toolbar_measure_timeout")); }, 5000);
      const observer = new MutationObserver(() => {
        if (Number(toolbar.getAttribute("data-measure-tick")) === 0) return;
        clearTimeout(timer); observer.disconnect(); resolve();
      });
      observer.observe(toolbar, { attributes: true, attributeFilter: ["data-measure-tick"] });
    });
  },
};
