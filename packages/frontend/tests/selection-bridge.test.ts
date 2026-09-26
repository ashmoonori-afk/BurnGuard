import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MODES } from "../src/components/canvas/CanvasTopBar";
import ModePanel from "../src/components/modes/ModePanel";
import type { CanvasMode } from "../src/components/modes/types";

const panelProps = {
  comments: [],
  activeRelPath: "index.html",
  activeSlideIdx: null,
  focusedCommentId: null,
  onFocusComment() {},
  onUpdateCommentBody() {},
  onToggleCommentResolved() {},
  editTarget: null,
  editSaving: false,
  onSaveEdit() {},
  onClearEdit() {},
  tweaksTarget: null,
  tweaksSaving: false,
  onApplyTweak() {},
  onResetTweaks() {},
  onClearTweaks() {},
  tweakReview: null,
  drawTool: "pen" as const,
  drawColor: "#EF4444",
  drawStrokeWidth: 4,
  drawHasShapes: false,
  drawCanRedo: false,
  onChangeDrawTool() {},
  onChangeDrawColor() {},
  onChangeDrawWidth() {},
  onUndoDraw() {},
  onRedoDraw() {},
  onClearDraw() {},
  quality: { state: { kind: "idle" as const }, pendingFindingId: null, focusedFindingId: null, revealResult: null, onRetry() {}, onOpenFile() {}, onReveal() {}, onApplySafeFix() {}, onAutoFix() {}, onRequestFix() {}, autoFixPending: false, autoFixDisabled: false },
  uxReview: { projectId: "project", relPath: "index.html", digest: "a".repeat(64), revision: 1, disabled: false, async onRequestAI() {} },
};

function panelMarkup(mode: CanvasMode): string {
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ModePanel, { mode, ...panelProps })));
}

describe("canvas mode table", () => {
  test("Given the toolbar modes When listed Then every id and hint is unique and the select alias is gone", () => {
    const ids = MODES.map((mode) => mode.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("select");
    const hints = MODES.map((mode) => mode.hint);
    expect(new Set(hints).size).toBe(hints.length);
  });

  test("Given each toolbar mode When its panel renders Then no two modes share the same panel markup", () => {
    const rendered = MODES.map((mode) => panelMarkup(mode.id));
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});
