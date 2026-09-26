import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Composer from "../src/components/chat/Composer";
import { t } from "../src/i18n/t";

function render(interruptPending: boolean): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Composer, {
    sessionId: "s1",
    onSend: () => {},
    disabled: true,
    canInterrupt: true,
    turnElapsedMs: 7000,
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
