import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ToolBadge from "../src/components/chat/blocks/ToolBadge";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";

test("Given phase and recovery progress, then all locales show user labels and bounded batch counters", () => {
  const snapshot = useLocaleStore.getInitialState();
  const original = snapshot.locale;
  try {
    for (const locale of LOCALES) {
      Object.assign(snapshot, { locale });
      for (const tool of ["generation_phase_plan", "generation_phase_content", "generation_resume_stalled", "generation_resume_incomplete", "generation_tool_failed"]) {
        const html = renderToStaticMarkup(createElement(ToolBadge, { tool, state: "running", input: { from: 5, to: 8, total: 29 } }));
        expect(html).not.toContain(tool);
        expect(html).toContain("flex-wrap");
        if (tool === "generation_phase_content") expect(html).toContain("5–8 / 29");
      }
    }
  } finally { Object.assign(snapshot, { locale: original }); }
});
