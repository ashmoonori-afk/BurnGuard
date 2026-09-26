import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drawHistoryAvailability, type DrawShape } from "../src/components/canvas/DrawLayer";
import DrawPanel from "../src/components/modes/DrawPanel";
import { t } from "../src/i18n/t";

const shape: DrawShape = { type: "rect", x: 1, y: 1, w: 10, h: 10, stroke: "#EF4444", strokeWidth: 2 };

test("Given shapes and a redo stack When availability is derived Then undo follows the shapes and redo follows the stack", () => {
  expect(drawHistoryAvailability([], [])).toEqual({ canUndo: false, canRedo: false });
  expect(drawHistoryAvailability([], [shape])).toEqual({ canUndo: false, canRedo: true });
  expect(drawHistoryAvailability([shape], [])).toEqual({ canUndo: true, canRedo: false });
});

test("Given an empty redo stack When DrawPanel renders Then the Redo button is disabled, and enabled once a shape was undone", () => {
  const panel = (canRedo: boolean) => renderToStaticMarkup(createElement(DrawPanel, { tool: "pen", color: "#EF4444", strokeWidth: 4, hasShapes: false, canRedo, onChangeTool() {}, onChangeColor() {}, onChangeWidth() {}, onUndo() {}, onRedo() {}, onClear() {} }));
  const redoButton = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes(t("modes.redo"))) ?? "";
  expect(redoButton(panel(false))).toContain('disabled=""');
  expect(redoButton(panel(true))).not.toContain('disabled=""');
});
