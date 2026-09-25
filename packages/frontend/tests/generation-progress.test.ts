import { expect, test } from "bun:test";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ToolBadge from "../src/components/chat/blocks/ToolBadge";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";
import { t, type MessageKey } from "../src/i18n/t";

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

test("Given deck review, logo repair and import setup tools including legacy Korean names When ToolBadge renders Then every locale shows the mapped message and no raw id", () => {
  const expected: Record<string, MessageKey> = {
    generation_deck_review: "chat.tool.deckReview",
    "덱 문안·글꼴·이미지·크기 점검": "chat.tool.deckReview",
    generation_logo_repair: "chat.tool.logoRepair",
    project_import_init: "chat.tool.importInit",
    "프로젝트 자동 초기화": "chat.tool.importInit",
  };
  const snapshot = useLocaleStore.getInitialState();
  const original = snapshot.locale;
  const current = useLocaleStore.getState().locale;
  try {
    for (const locale of LOCALES) {
      Object.assign(snapshot, { locale });
      useLocaleStore.setState({ locale });
      for (const [tool, key] of Object.entries(expected)) {
        const html = renderToStaticMarkup(createElement(ToolBadge, { tool, state: "finished" }));
        expect(html).toContain(`<span class="font-medium">${renderToStaticMarkup(createElement(Fragment, null, t(key)))}</span>`);
        expect(html).not.toMatch(/generation_|project_import/);
        if (locale !== "ko") expect(html).not.toMatch(/[가-힣]/);
      }
    }
  } finally {
    Object.assign(snapshot, { locale: original });
    useLocaleStore.setState({ locale: current });
  }
});
