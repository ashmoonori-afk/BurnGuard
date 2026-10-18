import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { authorizedFetch, isAuthorityExpired } from "../../src/api/client";
import Bootstrap from "../../src/components/Bootstrap";
import ProjectView from "../../src/views/ProjectView";
import { useLocaleStore } from "../../src/i18n/locale";
import { t } from "../../src/i18n/t";

export type AuthorityBrowserState = {
  bootstrap: string | null;
  expired: boolean;
  banner: boolean;
  draft: string | null;
  disabled: boolean | null;
  reason: "authority" | "disconnected" | null;
  sources: number;
  closed: number;
  opened: number;
  readyState: number | null;
  snapshotNetworkFailures: number;
};

declare global {
  var launchAuthorityTest: {
    mount(): void;
    state(): AuthorityBrowserState;
    observe(expected: Partial<AuthorityBrowserState>): Promise<AuthorityBrowserState>;
    duplicateErrors(): void;
    attemptMutation(): Promise<{ code: string; status: number }>;
    rememberComposer(): void;
    sameComposer(): boolean;
  };
}

const NativeEventSource = globalThis.EventSource;
const sources: EventSource[] = [];
let closed = 0;
let opened = 0;
let snapshotNetworkFailures = 0;
let composer: Element | null = null;
const changed = () => document.dispatchEvent(new Event("f08:state"));
// Observe the real fetch rejection; no response or authority decision is mocked.
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  try { return await nativeFetch(input, init); }
  catch (error) {
    if (String(input).endsWith("/snapshot")) { snapshotNetworkFailures += 1; changed(); }
    throw error;
  }
};
class ObservedEventSource extends NativeEventSource {
  constructor(url: string | URL, init?: EventSourceInit) {
    super(url, init);
    sources.push(this);
    this.addEventListener("open", () => { opened += 1; changed(); });
    this.addEventListener("error", changed);
    changed();
  }
  override close() {
    super.close();
    closed += 1;
    changed();
  }
}
globalThis.EventSource = ObservedEventSource;
const container = document.getElementById("root");
if (!container) throw new Error("Missing launch authority fixture root");
const root = createRoot(container);
const state = (): AuthorityBrowserState => {
  const input = document.querySelector<HTMLTextAreaElement>("textarea");
  return {
    bootstrap: document.querySelector("[data-bootstrap-state]")?.getAttribute("data-bootstrap-state") ?? null,
    expired: isAuthorityExpired(),
    banner: document.querySelector("[data-authority-expired]") !== null,
    draft: input?.value ?? null,
    disabled: input?.disabled ?? null,
    reason: input?.placeholder === t("chat.composer.placeholderAuthority") ? "authority" : input?.placeholder === t("chat.composer.placeholderDisconnected") ? "disconnected" : null,
    sources: sources.length,
    closed,
    opened,
    readyState: sources.at(-1)?.readyState ?? null,
    snapshotNetworkFailures,
  };
};
new MutationObserver(changed).observe(container, { subtree: true, attributes: true, childList: true, characterData: true });
globalThis.launchAuthorityTest = {
  mount() {
    useLocaleStore.setState({ locale: "en" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    root.render(<Bootstrap><QueryClientProvider client={client}><BrowserRouter><Routes>
      <Route path="/projects/:id" element={<ProjectView />} />
    </Routes></BrowserRouter></QueryClientProvider></Bootstrap>);
  },
  state,
  observe(expected) {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); document.removeEventListener("f08:state", check); };
      const check = () => {
        const current = state();
        if (Object.entries(expected).every(([key, value]) => current[key as keyof AuthorityBrowserState] === value)) {
          cleanup();
          resolve(current);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Authority browser state not observed: ${JSON.stringify({ expected: { ...expected, draft: undefined }, current: { ...state(), draft: undefined } })}`));
      }, 5000);
      document.addEventListener("f08:state", check);
      check();
    });
  },
  duplicateErrors() {
    const source = sources.at(-1);
    if (!source) throw new Error("No native EventSource to exercise");
    source.dispatchEvent(new Event("error"));
    source.dispatchEvent(new Event("error"));
  },
  async attemptMutation() {
    try {
      await authorizedFetch("/api/projects/f08-forbidden-write", { method: "DELETE" });
      throw new Error("Mutation unexpectedly reached the network");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string" || !("status" in error) || typeof error.status !== "number") throw error;
      return { code: error.code, status: error.status };
    }
  },
  rememberComposer() { composer = document.querySelector("textarea"); },
  sameComposer() { return composer !== null && composer === document.querySelector("textarea"); },
};
