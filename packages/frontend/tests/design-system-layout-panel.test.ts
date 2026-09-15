import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesignSystemLayout } from "@bg/shared";
import { DesignSystemLayoutPanel } from "../src/components/systems/DesignSystemLayoutPanel";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";
import { systemMessages } from "../src/i18n/messages/system";
import { formatMessage } from "../src/i18n/t";

test("Given current and older layout contracts When overview and compact panels render in every locale Then region rules remain visible and older rules retain their disclosure behavior", async () => {
  const base: DesignSystemLayout = {
    schema_version: 1, supplemented: false,
    tokens: {
      "--layout-max": "1200px", "--layout-measure": "64ch", "--layout-columns": "12",
      "--layout-gutter": "24px", "--layout-margin": "24px", "--layout-section-y": "64px",
      "--layout-bp-md": "768px", "--layout-hero": "1.5", "--family-hero-pattern": "internal-pattern-sentinel",
    },
    sections: [
      { kind: "layout", text: "layout-rule-sentinel" },
      { kind: "composition", text: "composition-rule-sentinel" },
      { kind: "responsive", text: "responsive-rule-sentinel" },
      { kind: "family", text: "family-rule-sentinel" },
    ],
  };
  const regions: DesignSystemLayout["sections"] = [
    { kind: "navigation", text: "navigation-rule-sentinel" },
    { kind: "hero", text: "hero-rule-sentinel" },
    { kind: "footer", text: "footer-rule-sentinel" },
  ];
  const regionKeys = ["system.layout.navigation", "system.layout.heroSection", "system.layout.footer"] as const;
  for (const locale of LOCALES) {
    const snapshot = useLocaleStore.getInitialState();
    const originalLocale = snapshot.locale;
    Object.assign(snapshot, { locale });
    try {
      for (const compact of [false, true]) for (const withRegions of [false, true]) {
        const layout = { ...base, tokens: { ...base.tokens, ...(withRegions ? { "--layout-hero-media-ratio": "1.75" } : {}) }, sections: [...base.sections, ...(withRegions ? regions : [])] };
        const html = renderToStaticMarkup(createElement(DesignSystemLayoutPanel, { layout, compact }));
        const headings: string[] = [];
        const metricValues: string[] = [];
        let allRules = "", collapsedRules = "", closedDetails = 0;
        await new HTMLRewriter()
          .on("h3", { element() { headings.push(""); }, text(chunk) { headings[headings.length - 1] += chunk.text; } })
          .on("dd", { element() { metricValues.push(""); }, text(chunk) { metricValues[metricValues.length - 1] += chunk.text; } })
          .on("p", { text(chunk) { allRules += chunk.text; } })
          .on("details:not([open])", { element() { closedDetails++; } })
          .on("details:not([open]) p", { text(chunk) { collapsedRules += chunk.text; } })
          .transform(new Response(html)).text();
        expect(closedDetails).toBe(compact ? 1 : 0);
        expect(metricValues.filter(value => value === "1.5" || value === "1.75")).toEqual([withRegions ? "1.75" : "1.5"]);
        for (const section of base.sections) {
          expect(allRules).toContain(section.text);
          expect(collapsedRules.includes(section.text)).toBe(compact);
        }
        for (const [index, section] of regions.entries()) {
          expect(allRules.includes(section.text)).toBe(withRegions);
          expect(collapsedRules).not.toContain(section.text);
          expect(headings.includes(formatMessage(systemMessages[regionKeys[index]!][locale], locale))).toBe(withRegions);
        }
        expect(html).not.toContain("internal-pattern-sentinel");
      }
    } finally {
      Object.assign(snapshot, { locale: originalLocale });
    }
  }
});
