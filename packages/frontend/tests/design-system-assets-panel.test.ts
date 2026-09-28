import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ASSET_KINDS, type DesignSystemAssetGuide } from "@bg/shared";
import { DesignSystemAssetsPanel } from "../src/components/systems/DesignSystemAssetsPanel";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";
import { systemMessages } from "../src/i18n/messages/system";
import { formatMessage } from "../src/i18n/t";

async function inspect(html: string) {
  const headings: string[] = [];
  let collapsed = "", visible = "", status = "", buttons = 0;
  await new HTMLRewriter()
    .on("h3", { element() { headings.push(""); }, text(chunk) { headings[headings.length - 1] += chunk.text; } })
    .on("details:not([open]) p", { text(chunk) { collapsed += chunk.text; } })
    .on("article > div > p", { text(chunk) { visible += chunk.text; } })
    .on("[role=status]", { text(chunk) { status += chunk.text; } })
    .on("button", { element() { buttons++; } })
    .transform(new Response(html)).text();
  return { headings, collapsed, visible, status, buttons };
}

test("Given asset guides When the panel renders in every locale Then each kind shows its usage, keeps prompts in closed disclosures with one copy action, and an older system shows the empty state", async () => {
  const guide: DesignSystemAssetGuide = { schema_version: 1, rules: [
    { kind: "logo", usage: "logo-usage-sentinel", prompt: "logo-prompt-sentinel", negative: "logo-negative-sentinel" },
    { kind: "photography", usage: "photo-usage-sentinel", prompt: null, negative: null },
    { kind: "motion", usage: null, prompt: "motion-prompt-sentinel", negative: null },
    { kind: "patterns", usage: null, prompt: null, negative: "patterns-negative-sentinel" },
  ] };
  for (const locale of LOCALES) {
    const snapshot = useLocaleStore.getInitialState();
    const originalLocale = snapshot.locale;
    Object.assign(snapshot, { locale });
    try {
      const filled = await inspect(renderToStaticMarkup(createElement(DesignSystemAssetsPanel, { assets: guide })));
      expect(filled.headings).toEqual(guide.rules.map(rule => formatMessage(systemMessages[`system.assets.kind.${rule.kind}`][locale], locale)));
      expect(filled.visible).toContain("logo-usage-sentinel");
      expect(filled.visible).toContain("photo-usage-sentinel");
      for (const hidden of ["logo-prompt-sentinel", "logo-negative-sentinel", "motion-prompt-sentinel", "patterns-negative-sentinel"]) {
        expect(filled.collapsed).toContain(hidden);
        expect(filled.visible).not.toContain(hidden);
      }
      expect(filled.buttons).toBe(2);
      expect(filled.status).toBe("");

      const empty = await inspect(renderToStaticMarkup(createElement(DesignSystemAssetsPanel, { assets: { schema_version: 1, rules: [] } })));
      expect(empty.status).toBe(formatMessage(systemMessages["system.assets.empty"][locale], locale));
      expect(empty.headings).toEqual([]);
      expect((await inspect(renderToStaticMarkup(createElement(DesignSystemAssetsPanel, {})))).status).toBe(formatMessage(systemMessages["system.assets.empty"][locale], locale));
    } finally {
      Object.assign(snapshot, { locale: originalLocale });
    }
  }
  expect(ASSET_KINDS.every(kind => `system.assets.kind.${kind}` in systemMessages)).toBe(true);
});
