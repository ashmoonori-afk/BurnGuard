import { expect, test } from "bun:test";
import { canvasLoadErrorKey } from "../src/lib/canvas-load-error";

test("Given an artifact load status When the canvas copy key is resolved Then each status names its own recovery", () => {
  expect(canvasLoadErrorKey(409)).toBe("workspace.canvas.identityUnavailable");
  expect(canvasLoadErrorKey(404)).toBe("workspace.canvas.fileNotFound");
  expect(canvasLoadErrorKey(401)).toBe("workspace.canvas.unauthorized");
  expect(canvasLoadErrorKey(403)).toBe("workspace.canvas.unauthorized");
  expect(canvasLoadErrorKey(500)).toBe("workspace.canvas.connectionError");
  expect(canvasLoadErrorKey(undefined)).toBe("workspace.canvas.connectionError");
});
