import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { canvasPoint } from "../src/components/canvas/canvas-coordinates";
import { buildCommentEditRequest, saveAndRequestCommentEdit } from "../src/components/modes/comment-edit-request";
import { parseLocalFonts, type Comment } from "@bg/shared";

test("Given a zoomed and moved canvas When pointing Then hit and draw coordinates remain unscaled", () => {
  const element = { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ left: 120, top: 70, width: 400, height: 300 }) } as HTMLElement;
  expect(canvasPoint(element, 220, 145)).toEqual([200, 150]);
});

test("Given persisted comment identity When explicitly sent Then the request contains file, element and revision", () => {
  const comment = { id: "c1", rel_path: "index.html", node_selector: "#hero", slide_index: 0, artifact_revision: 7, artifact_digest: "abc", body: "Make this blue" } as Comment;
  const request = JSON.parse(buildCommentEditRequest(comment).split("\n")[1]!);
  expect(request).toEqual({ comment_id: "c1", file: "index.html", element: "#hero", slide_index: 0, artifact_revision: 7, artifact_digest: "abc", request: "Make this blue" });
});

test("Given native font families When parsed Then deduplicated names exclude private paths", () => {
  expect(parseLocalFonts({ schema_version: 1, families: ["Segoe UI", "Arial", "Arial"] }).families).toEqual(["Arial", "Segoe UI"]);
  expect(() => parseLocalFonts({ schema_version: 1, families: ["C:\\private\\font.ttf"] })).toThrow();
});

test("Given an edited draft When explicitly requested Then persistence finishes before send and save failure prevents send", async () => {
  const events: string[] = [];
  const persisted = { id: "c1", body: "saved draft", rel_path: "index.html", node_selector: "#hero", resolved_at: null } as Comment;
  await saveAndRequestCommentEdit(async () => { events.push("saved"); return persisted; }, async (comment, text) => { events.push("sent"); expect(comment).toBe(persisted); expect(text).toContain("saved draft"); });
  expect(events).toEqual(["saved", "sent"]);
  await expect(saveAndRequestCommentEdit(async () => { throw new Error("save_failed"); }, async () => { events.push("unexpected"); })).rejects.toThrow("save_failed");
  expect(events).toEqual(["saved", "sent"]);
});

test("Given an overlay wheel When the tagged parent requests scrolling Then the nested scroller moves and foreign sources are ignored", () => {
  const script = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html").match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const listeners = new Map<string, (event: unknown) => void>();
  const root = {};
  const node = { scrollLeft: 0, scrollTop: 0, parentElement: root };
  const parent = { postMessage() {} };
  let windowScroll = 0;
  runInNewContext(script, {
    window: { parent, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), getComputedStyle: () => ({ overflowY: "auto", overflowX: "auto" }), scrollBy: () => { windowScroll++; } },
    document: { readyState: "loading", addEventListener() {}, documentElement: root, elementFromPoint: () => node },
  });
  const data = { __bgFrameBridge: true, type: "request", requestId: "wheel", action: "scroll-at-point", payload: { x: 10, y: 20, deltaX: 0, deltaY: 80 } };
  listeners.get("message")!({ source: {}, data });
  expect(node.scrollTop).toBe(0);
  listeners.get("message")!({ source: parent, data });
  expect(node.scrollTop).toBe(80);
  expect(windowScroll).toBe(0);
});
