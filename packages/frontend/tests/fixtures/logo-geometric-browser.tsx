import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { LogoGeometricActionV1, LogoGeometricStatusV1 } from "@bg/shared";
import { useLocaleStore, type Locale } from "../../src/i18n/locale";
import { t } from "../../src/i18n/t";
import LogoGeometricPanel from "../../src/components/logo/LogoGeometricPanel";

type Geometric = Extract<LogoGeometricStatusV1, { method: "geometric" }>;
export type LogoGeometricFixtureEvent = { readonly kind: "action"; readonly action: LogoGeometricActionV1 } | { readonly kind: "make" } | { readonly kind: "retry" };

declare global {
  var logoGeometricTest: {
    mount(options: { locale: Locale; dark: boolean; status: Geometric | null; disabled: boolean; loadFailed: boolean }): void;
    events: LogoGeometricFixtureEvent[];
    labels(): Record<
      "start" | "symbolOnly" | "sharp" | "other" | "otherLabel" | "approve" | "revise" | "noteLabel" | "sendNote" | "cancel" | "make" | "retry" | "plan" | "later",
      string
    >;
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("logo_geometric_fixture_root_missing");
const root = createRoot(container);

globalThis.logoGeometricTest = {
  events: [],
  labels: () => ({
    start: t("logo.geometric.start"),
    symbolOnly: t("logo.geometric.parts.symbol"),
    sharp: t("logo.geometric.direction.sharp_geometric"),
    other: t("logo.geometric.other"),
    otherLabel: t("logo.geometric.otherLabel"),
    approve: t("logo.geometric.approve"),
    revise: t("logo.geometric.revise"),
    noteLabel: t("logo.geometric.noteLabel"),
    sendNote: t("logo.geometric.sendNote"),
    cancel: t("logo.geometric.cancel"),
    make: t("logo.geometric.make"),
    retry: t("logo.geometric.retry"),
    plan: t("logo.geometric.plan"),
    later: t("logo.geometric.later"),
  }),
  mount({ locale, dark, status, disabled, loadFailed }) {
    useLocaleStore.setState({ locale });
    // One page serves several states and both themes, so each mount starts from a clean record.
    document.documentElement.dataset["theme"] = dark ? "dark" : "light";
    const events = globalThis.logoGeometricTest.events;
    events.length = 0;
    // A new status is a new server state, so the panel remounts as it does after a turn.
    flushSync(() => root.render(
      <div className="flex min-h-screen min-w-0 flex-col bg-background text-foreground">
        <LogoGeometricPanel
          key={JSON.stringify(status)}
          status={status}
          loadFailed={loadFailed}
          disabled={disabled}
          onAction={(action) => events.push({ kind: "action", action })}
          onMake={() => events.push({ kind: "make" })}
          onRetry={() => events.push({ kind: "retry" })}
        />
        <main className="min-h-48 flex-1 bg-muted/40" />
      </div>,
    ));
  },
};
