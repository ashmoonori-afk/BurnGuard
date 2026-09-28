import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesignSystemPageCoverage } from "@bg/shared";
import { DesignSystemPagesPanel } from "../src/components/systems/DesignSystemPagesPanel";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";
import { systemMessages } from "../src/i18n/messages/system";
import { formatMessage } from "../src/i18n/t";

test("Given page coverage When the panel renders in every locale Then every page shows its type and status and differences are listed, while an older system renders nothing", async () => {
  const coverage: DesignSystemPageCoverage = {
    schema_version: 1, page_limit: 4, discovered: 3,
    pages: [
      { path: "/", page_type: "home", source: "entry", status: "extracted", skip_reason: null, layout_tokens: {}, patterns: ["hero-sentinel"], colors: [], fonts: [] },
      { path: "/private", page_type: "other", source: "nav", status: "skipped", skip_reason: "robots", layout_tokens: {}, patterns: [], colors: [], fonts: [] },
      { path: "/about", page_type: "about", source: "footer", status: "skipped", skip_reason: "cap", layout_tokens: {}, patterns: [], colors: [], fonts: [] },
    ],
    templates: [],
    differences: [{ key: "--layout-max", values: [{ path: "/", value: "1140px" }, { path: "/pricing", value: "960px" }] }],
  };
  for (const locale of LOCALES) {
    const snapshot = useLocaleStore.getInitialState();
    const original = snapshot.locale;
    Object.assign(snapshot, { locale });
    try {
      const cells: string[] = [];
      let listText = "";
      const html = renderToStaticMarkup(createElement(DesignSystemPagesPanel, { pages: coverage }));
      await new HTMLRewriter()
        .on("td", { element() { cells.push(""); }, text(chunk) { cells[cells.length - 1] += chunk.text; } })
        .on("li", { text(chunk) { listText += chunk.text; } })
        .transform(new Response(html)).text();
      const message = (key: keyof typeof systemMessages) => formatMessage(systemMessages[key][locale], locale);
      expect(cells).toEqual([
        "/", message("system.pages.type.home"), message("system.pages.extracted"), "hero-sentinel",
        "/private", message("system.pages.type.other"), message("system.pages.reason.robots"), "",
        "/about", message("system.pages.type.about"), message("system.pages.reason.cap"), "",
      ]);
      expect(listText).toContain("960px");
    } finally {
      Object.assign(snapshot, { locale: original });
    }
  }
  expect(renderToStaticMarkup(createElement(DesignSystemPagesPanel, {}))).toBe("");
});
