import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootstrapApiAuthority } from "../../src/api/client";
import { listSessionEvents } from "../../src/api/session";
import NewProjectPanel from "../../src/components/home/NewProjectPanel";
import UserMessage from "../../src/components/chat/blocks/UserMessage";
import { loadComposerDraft, type ComposerDraft } from "../../src/components/chat/useComposerDraft";
import { CREATION_DRAFT_KEY, serializeCreationDraft } from "../../src/lib/creation-draft";
import { INITIAL_BRIEF_FORM } from "../../src/lib/project-creation";
import { useLocaleStore } from "../../src/i18n/locale";
import HomeView from "../../src/views/HomeView";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CreateProjectResponse, DesignSystemSummary } from "@bg/shared";

const systems: DesignSystemSummary[] = [{
  id: "published-system", name: "Quiet", status: "published", is_template: false,
  thumbnail_path: null, updated_at: 1,
}];

declare global {
  var creationTest: {
    mount(complete: boolean, guide?: boolean): Promise<void>;
    draft: ComposerDraft | null;
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("Creation fixture root missing");
const root = createRoot(container);
globalThis.creationTest = {
  draft: null,
  async mount(complete, guide = false) {
    flushSync(() => root.render(null));
    await bootstrapApiAuthority();
    useLocaleStore.setState({ locale: "en" });
    localStorage.setItem(CREATION_DRAFT_KEY("prototype"), serializeCreationDraft({
      ...INITIAL_BRIEF_FORM,
      ...(complete ? { name: "Bakery", audience: "Visitors", objective: "A bakery website" } : {}),
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["backends", "detect"], { backends: [{ id: "claude-code", found: true, authenticated: true }, { id: "codex", found: true, authenticated: false }] });
    client.setQueryData(["settings"], { default_backend: "claude-code" });
    client.setQueryData(["design-systems", "all"], systems);
    for (const tab of ["recent", "mine", "examples"]) client.setQueryData(["projects", tab], []);
    async function showWorkspace(created: CreateProjectResponse) {
      globalThis.creationTest.draft = await loadComposerDraft(created.session_id);
      const events = await listSessionEvents(created.session_id);
      flushSync(() => root.render(<main data-qa="created">
        {events.map(({ event }) => event.type === "chat.user_message"
          ? <UserMessage key={event.id} text={event.text} turnId={event.turnId} />
          : null)}
      </main>));
    }
    function CreatedWorkspace() {
      useEffect(() => {
        void showWorkspace({ id: "project", session_id: "session", dir_path: "", entrypoint: "index.html" });
      }, []);
      return null;
    }
    flushSync(() => root.render(<StrictMode><QueryClientProvider client={client}>
      {guide ? <MemoryRouter><Routes>
        <Route path="/" element={<HomeView />} />
        <Route path="/projects/:id" element={<CreatedWorkspace />} />
      </Routes></MemoryRouter> : <NewProjectPanel type="prototype" designSystems={systems} defaultBackend="claude-code"
        systemsLoading={false} systemsError={null} onRetrySystems={() => {}}
        onCreated={(created) => { void showWorkspace(created); }} />}
    </QueryClientProvider></StrictMode>));
  },
};
