import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootstrapApiAuthority } from "../../src/api/client";
import { useLocaleStore } from "../../src/i18n/locale";
import DesignSystemPalettePanel from "../../src/views/DesignSystemPalettePanel";

const root = document.getElementById("root");
if (!root) throw new Error("PALETTE_FIXTURE_ROOT");
useLocaleStore.setState({ locale: "en" });
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
void bootstrapApiAuthority().then(() => {
  createRoot(root).render(
    <QueryClientProvider client={client}>
      <DesignSystemPalettePanel systemId="palette-editor" />
    </QueryClientProvider>,
  );
});
