import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Composer from "../src/components/chat/Composer";
import InterruptButton from "../src/components/chat/InterruptButton";
import { t } from "../src/i18n/t";

function render(interruptPending: boolean, turnStartedAt: number | null = Date.now() - 7000): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Composer, {
    sessionId: "s1",
    onSend: () => {},
    disabled: true,
    turnStartedAt,
    interruptPending,
    onInterrupt: () => {},
  })));
}

function buttonContaining(html: string, label: string): string {
  const button = html.split("<button").find((part) => part.includes(label));
  if (button === undefined) throw new TypeError(`no button carries ${label}`);
  return button;
}

test("Given a stop that was requested and is still being honoured When the composer renders Then the Stop button stays disabled with the stopping copy", () => {
  const button = buttonContaining(render(true), t("workspace.composer.interrupting"));
  expect(button).toContain('disabled=""');
  expect(button).not.toContain(t("workspace.composer.interruptElapsed", { time: "0:07" }));
});

test("Given a running turn past the grace period When the composer renders Then the Stop button is enabled and shows the elapsed time", () => {
  const button = buttonContaining(render(false), t("workspace.composer.interruptElapsed", { time: "0:07" }));
  expect(button).not.toContain('disabled=""');
});

test("Given a turn inside the grace period or no turn When the interrupt button renders Then no Stop button shows (UXW-16)", () => {
  expect(render(false, Date.now())).not.toContain(t("workspace.composer.interruptTitle"));
  expect(render(false, null)).not.toContain(t("workspace.composer.interruptTitle"));
  expect(renderToStaticMarkup(createElement(InterruptButton, { busy: false, turnStartedAt: Date.now() - 9000, pending: false, onInterrupt() {} }))).toBe("");
});

test("Given the project view and the interrupt button sources When scanned Then only the interrupt button owns the one-second ticker", async () => {
  const projectView = await Bun.file(new URL("../src/views/ProjectView.tsx", import.meta.url)).text();
  const interruptButton = await Bun.file(new URL("../src/components/chat/InterruptButton.tsx", import.meta.url)).text();
  expect(projectView).not.toContain("setInterval");
  expect(projectView).not.toContain("nowTs");
  expect(interruptButton).toContain("setInterval");
});
