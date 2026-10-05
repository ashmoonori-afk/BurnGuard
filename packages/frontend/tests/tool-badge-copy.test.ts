import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ToolBadge from "@/components/chat/blocks/ToolBadge";
import { LOCALES, useLocaleStore } from "@/i18n/locale";
import { t, type MessageKey } from "@/i18n/t";
import { toolBadgeCopy, type ToolBadgeState } from "@/lib/tool-badge-copy";

const providerCases: readonly (readonly [string, MessageKey])[] = [
  ["command_execution", "chat.tool.command"],
  ["file_change", "chat.tool.fileChange"],
  ["web_search", "chat.tool.webSearch"],
  ["mcp_tool_call", "chat.tool.mcpCall"],
  ["custom_tool_call", "chat.tool.customCall"],
  ["image_generation", "chat.tool.imageGeneration"],
  ["image_generation_call", "chat.tool.imageGeneration"],
  ["Bash", "chat.tool.command"],
  ["Read", "chat.tool.fileRead"],
  ["Write", "chat.tool.fileChange"],
  ["Edit", "chat.tool.fileChange"],
  ["MultiEdit", "chat.tool.fileChange"],
  ["NotebookEdit", "chat.tool.fileChange"],
  ["Glob", "chat.tool.fileSearch"],
  ["Grep", "chat.tool.fileSearch"],
  ["WebSearch", "chat.tool.webSearch"],
  ["WebFetch", "chat.tool.webFetch"],
  ["Agent", "chat.tool.agent"],
  ["Task", "chat.tool.agent"],
  ["TodoWrite", "chat.tool.taskPlan"],
  ["mcp__fixture_server__read_document", "chat.tool.mcpCall"],
  ["future_provider_event", "chat.tool.activity"],
  ["unknown", "chat.tool.activity"],
  ["toString", "chat.tool.activity"],
];

describe("Tool activity copy", () => {
  test.each(providerCases)(
    "Given provider tool %s When badge copy is chosen Then its task label key is %s",
    (tool, nameKey) => {
      expect(toolBadgeCopy(tool, "running")).toEqual({ nameKey, stateKey: "chat.tool.running" });
    },
  );

  test("Given a successful or failed tool When badge copy is chosen Then the action stays the same and the status keys differ", () => {
    expect(toolBadgeCopy("command_execution", "finished")).toEqual({
      nameKey: "chat.tool.command", stateKey: "chat.tool.finished",
    });
    expect(toolBadgeCopy("command_execution", "error")).toEqual({
      nameKey: "chat.tool.command", stateKey: "chat.tool.error",
    });
  });

  test("Given existing generation and legacy events When badge copy is chosen Then specialized labels and review failure remain", () => {
    expect(toolBadgeCopy("generation_design_review", "error")).toEqual({
      nameKey: "chat.tool.designReview", stateKey: "chat.tool.reviewIncomplete",
    });
    expect(toolBadgeCopy("generation_save", "error").nameKey).toBe("chat.tool.saveArtifact");
    expect(toolBadgeCopy("generation_tool_failed", "error").nameKey).toBe("chat.tool.providerFailed");
    expect(toolBadgeCopy("덱 문안·글꼴·이미지·크기 점검", "finished").nameKey).toBe("chat.tool.deckReview");
    expect(toolBadgeCopy("프로젝트 자동 초기화", "finished").nameKey).toBe("chat.tool.importInit");
  });

  for (const locale of LOCALES) {
    test(`Given ${locale} and provider events When real badges render Then labels match registered copy and retain each status`, () => {
      const original = useLocaleStore.getState().locale;
      const initial = useLocaleStore.getInitialState();
      const originalInitial = initial.locale;
      // SSR reads Zustand's initial snapshot rather than a later browser locale selection.
      Object.assign(initial, { locale });
      useLocaleStore.setState({ locale });
      try {
        for (const [tool, nameKey] of providerCases) {
          for (const state of ["running", "finished", "error"] as const satisfies readonly ToolBadgeState[]) {
            const html = renderToStaticMarkup(createElement(ToolBadge, { tool, state }));
            const spans = [...html.matchAll(/<span(?: class="[^"]*")?>([^<]*)<\/span>/g)].map(match => match[1]);
            expect(spans, `${locale}/${tool}/${state}`).toEqual([
              t(nameKey), "·", t(toolBadgeCopy(tool, state).stateKey),
            ]);
          }
        }
      } finally {
        Object.assign(initial, { locale: originalInitial });
        useLocaleStore.setState({ locale: original });
      }
    });
  }
});
