import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Comment } from "@bg/shared";
import CommentPanel, { CommentItem, visibleComments } from "../src/components/modes/CommentPanel";
import { revealOutcome } from "../src/components/canvas/QualityLayer";
import { t } from "../src/i18n/t";

function comment(overrides: Partial<Comment>): Comment {
  return { id: "c", project_id: "p", rel_path: "index.html", node_selector: "#hero", slide_index: 0, x_pct: 10, y_pct: 10, anchor: null, body: "note", resolved_at: null, artifact_revision: 1, artifact_digest: "a".repeat(64), created_at: 1, ...overrides } as Comment;
}
const open = comment({ id: "open" });
const resolved = comment({ id: "resolved", resolved_at: 5 });
const otherSlide = comment({ id: "slide-1", slide_index: 1 });

const items = (html: string) => html.match(/data-qa="comment-item"/g)?.length ?? 0;
const textareaFor = (html: string, id: string) => html.match(new RegExp(`<div[^>]*data-qa="comment-item"[^>]*data-comment-id="${id}"[\\s\\S]*?<textarea[^>]*>`))?.[0] ?? "";

describe("comment visibility (UXM-06, UXM-30)", () => {
  test("Given a resolved and an open comment When resolved comments are hidden Then only the open one is listed", () => {
    expect(visibleComments([open, resolved], "index.html", null, false).map((c) => c.id)).toEqual(["open"]);
  });

  test("Given a resolved and an open comment When resolved comments are shown Then both are listed", () => {
    expect(visibleComments([open, resolved], "index.html", null, true).map((c) => c.id)).toEqual(["open", "resolved"]);
  });

  test("Given comments on two artboards When artboard 1 is active Then artboard 0 comments are excluded", () => {
    expect(visibleComments([open, otherSlide], "index.html", 1, false).map((c) => c.id)).toEqual(["slide-1"]);
    expect(visibleComments([open, otherSlide], "other.html", null, true)).toEqual([]);
  });

  test("Given the panel with a resolved comment When rendered with the default toggle Then only the open item renders and the toggle is offered", () => {
    const html = renderToStaticMarkup(createElement(CommentPanel, { comments: [open, resolved], activeRelPath: "index.html", activeSlideIdx: null, focusedId: null, onFocus() {}, onUpdateBody() {}, onToggleResolved() {} }));
    expect(items(html)).toBe(1);
    expect(html).toContain('data-qa="comments-show-resolved"');
    expect(html).toContain(t("workspace.comments.showResolved"));
  });
});

describe("new comment editor (UXM-07)", () => {
  test("Given a panel whose autoFocusId names one comment When rendered Then only that item's editor autofocuses", () => {
    const html = renderToStaticMarkup(createElement(CommentPanel, { comments: [open, otherSlide], activeRelPath: "index.html", activeSlideIdx: null, focusedId: "slide-1", autoFocusId: "slide-1", onFocus() {}, onUpdateBody() {}, onToggleResolved() {} }));
    expect(items(html)).toBe(2);
    expect(textareaFor(html, "slide-1")).toContain('autofocus=""');
    expect(textareaFor(html, "open")).not.toContain("autofocus");
  });
});

describe("busy reason on the AI request button (UXM-28)", () => {
  const item = (editDisabled: boolean) => renderToStaticMarkup(createElement(CommentItem, { comment: open, index: 1, focused: false, onFocus() {}, onUpdateBody() {}, onToggleResolved() {}, async onRequestEdit() {}, editDisabled }));
  const aiButton = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes(t("workspace.comments.saveAndEdit"))) ?? "";

  test("Given a running turn When the item renders Then the AI button is disabled and explains why", () => {
    const button = aiButton(item(true));
    expect(button).toContain('disabled=""');
    expect(button).toContain(`title="${t("workspace.project.busyTurn")}"`);
  });

  test("Given an idle session When the item renders Then the AI button carries no reason", () => {
    expect(aiButton(item(false))).not.toContain("title=");
  });
});

describe("quality reveal outcome (UXM-31)", () => {
  test("Given a missing or zero-area rect When the reveal resolves Then the node counts as not found", () => {
    expect(revealOutcome(null)).toBe(false);
    expect(revealOutcome({ left: 0, top: 0, width: 0, height: 0 })).toBe(false);
    expect(revealOutcome({ left: 0, top: 0, width: 12, height: 0 })).toBe(false);
    expect(revealOutcome({ left: 4, top: 8, width: 12, height: 20 })).toBe(true);
  });
});
