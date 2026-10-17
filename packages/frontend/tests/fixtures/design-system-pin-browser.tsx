import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DesignSystemTokensResponse, ProjectDesignSystemPin } from "@bg/shared";
import { bootstrapApiAuthority } from "../../src/api/client";
import { useLocaleStore } from "../../src/i18n/locale";
import { t } from "../../src/i18n/t";
import DesignSystemView from "../../src/views/DesignSystemView";
import ProjectDesignSystemVersion from "../../src/components/systems/ProjectDesignSystemVersion";

declare global {
  var designSystemPinTest: {
    mount(): Promise<void>;
    labels(): { edit: string; save: string };
    state(): { pin: ProjectDesignSystemPin | undefined; tokens: DesignSystemTokensResponse | undefined };
    armMutation(): void;
    mutation: Promise<"success" | "error">;
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("pin_fixture_root_missing");
const root = createRoot(container);
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

globalThis.designSystemPinTest = {
  mutation: Promise.resolve("success"),
  async mount() {
    await bootstrapApiAuthority();
    useLocaleStore.setState({ locale: "en" });
    flushSync(() => root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <main className="mx-auto max-w-6xl p-6">
            <section data-pin-banner><ProjectDesignSystemVersion projectId="pin-project" disabled={false} /></section>
            <DesignSystemView systemIdOverride="pin-system" />
          </main>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
  },
  labels: () => ({ edit: t("system.editColor", { name: "primary" }), save: t("system.saveColor") }),
  state: () => ({
    pin: client.getQueryData<ProjectDesignSystemPin>(["design-systems", "project-pin", "pin-project"]),
    tokens: client.getQueryData<DesignSystemTokensResponse>(["design-systems", "tokens", "pin-system"]),
  }),
  armMutation() {
    globalThis.designSystemPinTest.mutation = new Promise(resolve => {
      const unsubscribe = client.getMutationCache().subscribe(event => {
        if (event.type !== "updated") return;
        const status = event.mutation.state.status;
        if (status !== "success" && status !== "error") return;
        unsubscribe();
        resolve(status);
      });
    });
  },
};
