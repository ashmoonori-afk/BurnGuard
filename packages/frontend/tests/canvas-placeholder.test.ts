import { expect, test } from "bun:test";
import { canvasPlaceholderKeys, canvasRenderingVisible } from "../src/lib/canvas-placeholder";

test("Given no renderable file When the placeholder copy is chosen Then a working turn, a pending load and an empty project each read differently", () => {
  expect(canvasPlaceholderKeys({ src: null, loading: false, working: true })).toEqual({ title: "workspace.canvas.workingTitle", subtitle: "workspace.canvas.workingSubtitle" });
  expect(canvasPlaceholderKeys({ src: null, loading: true, working: false })).toEqual({ title: "workspace.canvas.loadingTitle", subtitle: "workspace.canvas.loadingSubtitle" });
  expect(canvasPlaceholderKeys({ src: null, loading: true, working: true })).toEqual({ title: "workspace.canvas.loadingTitle", subtitle: "workspace.canvas.loadingSubtitle" });
  expect(canvasPlaceholderKeys({ src: null, loading: false, working: false })).toEqual({ title: "workspace.canvas.placeholderTitle", subtitle: "workspace.canvas.placeholderSubtitle" });
});

test("Given a renderable file When the placeholder copy is chosen Then it is the loading copy while the frame fetches", () => {
  expect(canvasPlaceholderKeys({ src: "/api/projects/p/fs/index.html", loading: false, working: true }).title).toBe("workspace.canvas.loadingTitle");
});

test("Given a fetched document that has not painted When the rendering state is derived Then it shows until paint, and never for a failure or an empty frame", () => {
  expect(canvasRenderingVisible({ hasDocument: true, painted: false, failed: false })).toBe(true);
  expect(canvasRenderingVisible({ hasDocument: true, painted: true, failed: false })).toBe(false);
  expect(canvasRenderingVisible({ hasDocument: true, painted: false, failed: true })).toBe(false);
  expect(canvasRenderingVisible({ hasDocument: false, painted: false, failed: false })).toBe(false);
});
