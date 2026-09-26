import { describe, expect, test } from "bun:test";
import { resolveUndoAction, type TweaksUndoFrame } from "../src/lib/tweaks-history";

const frame: TweaksUndoFrame = { bg_id: "hero", relPath: "index.html", forward: { color: "#111111" }, inverse: { color: null } };

describe("resolveUndoAction", () => {
  test("Given a tweaks frame for the active file in Style mode When undoing Then the frame's inverse styles are patched, not the project history", () => {
    expect(resolveUndoAction({ mode: "tweaks", direction: "undo", frame, activeRelPath: "index.html", projectOperationId: "op-1" }))
      .toEqual({ kind: "tweak", frame, styles: { color: null } });
  });

  test("Given a redo frame in Style mode When redoing Then the frame's forward styles are patched", () => {
    expect(resolveUndoAction({ mode: "tweaks", direction: "redo", frame, activeRelPath: "index.html", projectOperationId: undefined }))
      .toEqual({ kind: "tweak", frame, styles: { color: "#111111" } });
  });

  test("Given an empty tweaks stack When undoing Then the project-wide restore runs", () => {
    expect(resolveUndoAction({ mode: "tweaks", direction: "undo", frame: undefined, activeRelPath: "index.html", projectOperationId: "op-1" }))
      .toEqual({ kind: "project", operationId: "op-1" });
  });

  test("Given a frame for another file or another mode When undoing Then the project history is used instead", () => {
    expect(resolveUndoAction({ mode: "tweaks", direction: "undo", frame, activeRelPath: "other.html", projectOperationId: "op-1" }))
      .toEqual({ kind: "project", operationId: "op-1" });
    expect(resolveUndoAction({ mode: "edit", direction: "undo", frame, activeRelPath: "index.html", projectOperationId: "op-1" }))
      .toEqual({ kind: "project", operationId: "op-1" });
  });

  test("Given nothing to undo When resolving Then no action is taken", () => {
    expect(resolveUndoAction({ mode: null, direction: "undo", frame: undefined, activeRelPath: "index.html", projectOperationId: undefined })).toEqual({ kind: "none" });
  });
});
