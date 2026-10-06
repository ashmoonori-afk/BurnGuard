import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChatPane from "../src/components/chat/ChatPane";
import { mockSession } from "../src/mocks/project-session";

const STATUS_SENTINEL = "data-bg-test-status-slot";

function statusWrapperClasses(html: string): readonly string[] {
  const index = html.indexOf(STATUS_SENTINEL);
  if (index < 0) throw new Error("status_slot_not_rendered");
  const wrapper = html.slice(0, index).match(/<div class="([^"]*)"><section $/);
  if (!wrapper?.[1]) throw new Error("status_slot_wrapper_missing");
  return wrapper[1].split(" ");
}

function renderPane(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ChatPane, {
        events: [],
        session: mockSession,
        projectDir: "/project",
        onSend: () => {},
        projectFiles: [],
        comments: [],
        activeRelPath: null,
        activeSlideIdx: null,
        focusedCommentId: null,
        onFocusComment: () => {},
        onUpdateCommentBody: () => {},
        onToggleCommentResolved: () => {},
        // Stands in for the logo candidate picker: four square previews are taller than the chat column.
        statusSlot: createElement("section", { [STATUS_SENTINEL]: "", style: { height: "2000px" } }),
      }),
    ),
  );
}

test("Given a status panel taller than the chat column When the chat pane lays out Then the panel scrolls inside a bounded region instead of pushing the conversation and composer out of view", () => {
  const classes = statusWrapperClasses(renderPane());

  // A shrink-0 wrapper with no height bound takes the whole column: the message list collapses to zero
  // height and the composer is clipped by the pane's overflow-hidden edge, so the chat looks closed.
  expect(classes).not.toContain("shrink-0");
  expect(classes.some((name) => /^max-h-\[\d+%\]$/.test(name))).toBe(true);
  expect(classes).toContain("overflow-y-auto");
  expect(classes).toContain("min-h-0");
});
