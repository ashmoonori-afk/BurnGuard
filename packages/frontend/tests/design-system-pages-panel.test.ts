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
      { path: "/", page_type: "home", source: "entry", status: "extracted", skip_reason: null, layout_tokens: {}, patterns: ["hero-sentinel"], colors: [], fonts: [], custom_properties: {}, evidence: null },
      { path: "/private", page_type: "other", source: "nav", status: "skipped", skip_reason: "robots", layout_tokens: {}, patterns: [], colors: [], fonts: [], custom_properties: {}, evidence: null },
      { path: "/about", page_type: "about", source: "footer", status: "skipped", skip_reason: "cap", layout_tokens: {}, patterns: [], colors: [], fonts: [], custom_properties: {}, evidence: null },
    ],
    templates: [],
    differences: [{ key: "--layout-max", values: [{ path: "/", value: "1140px" }, { path: "/pricing", value: "960px" }] }],
  };
  for (const locale of LOCALES) {
    const snapshot = useLocaleStore.getInitialState();
    const original = snapshot.locale;
    Object.assign(snapshot, { locale });
    try {
      const rows: { path: string; type: string; status: string; collapsed: boolean }[] = [];
      let differenceText = "";
      const html = renderToStaticMarkup(createElement(DesignSystemPagesPanel, { pages: coverage }));
      let collapsed = false;
      await new HTMLRewriter()
        .on("details", { element(element) { collapsed = true; element.onEndTag(() => { collapsed = false; }); } })
        .on("li[data-page-path]", { element(element) { rows.push({ path: element.getAttribute("data-page-path") ?? "", type: "", status: "", collapsed }); } })
        .on("li[data-page-path] [data-field=type]", { text(chunk) { rows[rows.length - 1]!.type += chunk.text; } })
        .on("li[data-page-path] [data-field=status]", { text(chunk) { rows[rows.length - 1]!.status += chunk.text; } })
        .on("li[data-difference]", { text(chunk) { differenceText += chunk.text; } })
        .transform(new Response(html)).text();
      const message = (key: keyof typeof systemMessages) => formatMessage(systemMessages[key][locale], locale);
      expect(rows).toEqual([
        { path: "/", type: message("system.pages.type.home"), status: message("system.pages.extracted"), collapsed: false },
        { path: "/private", type: message("system.pages.type.other"), status: message("system.pages.reason.robots"), collapsed: true },
        { path: "/about", type: message("system.pages.type.about"), status: message("system.pages.reason.cap"), collapsed: true },
      ]);
      expect(html).toContain("hero-sentinel");
      expect(differenceText).toContain("960px");
    } finally {
      Object.assign(snapshot, { locale: original });
    }
  }
  expect(renderToStaticMarkup(createElement(DesignSystemPagesPanel, {}))).toBe("");
});
