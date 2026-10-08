import { describe, expect, test } from "bun:test";
import { resolveUndoAction, undoChordDirection, type TweaksUndoFrame } from "../src/lib/tweaks-history";

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

describe("undoChordDirection", () => {
  const chord = (over: Partial<Parameters<typeof undoChordDirection>[0]>) =>
    undoChordDirection({ key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

  test("Given Ctrl+Z or Cmd+Z When classifying Then it is undo, and with Shift it is redo", () => {
    expect(chord({ key: "z", code: "KeyZ", ctrlKey: true })).toBe("undo");
    expect(chord({ key: "z", code: "KeyZ", metaKey: true })).toBe("undo");
    expect(chord({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true })).toBe("redo");
  });

  test("Given Ctrl+Y When classifying Then it is redo, but Cmd+Y and Ctrl+Shift+Y are ignored", () => {
    expect(chord({ key: "y", code: "KeyY", ctrlKey: true })).toBe("redo");
    expect(chord({ key: "y", code: "KeyY", metaKey: true })).toBeNull();
    expect(chord({ key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true })).toBeNull();
  });

  test("Given a non-Latin layout When the physical Z or Y key is pressed Then the code still matches", () => {
    expect(chord({ key: "\u314b", code: "KeyZ", ctrlKey: true })).toBe("undo");
    expect(chord({ key: "\u315b", code: "KeyY", ctrlKey: true })).toBe("redo");
  });

  test("Given a punctuation key that shares the physical Z or Y position on a Latin layout When classifying Then the code path is not taken", () => {
    expect(chord({ key: ";", code: "KeyZ", ctrlKey: true })).toBeNull();
    expect(chord({ key: ":", code: "KeyZ", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(chord({ key: "[", code: "KeyY", ctrlKey: true })).toBeNull();
    expect(chord({ key: "1", code: "KeyY", ctrlKey: true })).toBeNull();
  });

  test("Given a Cyrillic layout When the physical Z or Y key is pressed Then the code still matches", () => {
    expect(chord({ key: "\u044f", code: "KeyZ", ctrlKey: true })).toBe("undo");
    expect(chord({ key: "\u043d", code: "KeyY", ctrlKey: true })).toBe("redo");
    expect(chord({ key: "\u042f", code: "KeyZ", ctrlKey: true, shiftKey: true })).toBe("redo");
  });

  test("Given a Latin letter key on a non-QWERTY layout When classifying Then the key wins over the physical code", () => {
    expect(chord({ key: "y", code: "KeyZ", ctrlKey: true })).toBe("redo");
    expect(chord({ key: "f", code: "KeyY", ctrlKey: true })).toBeNull();
    expect(chord({ key: "w", code: "KeyZ", ctrlKey: true })).toBeNull();
  });

  test("Given no modifier, Alt, or another key When classifying Then nothing matches", () => {
    expect(chord({ key: "z", code: "KeyZ" })).toBeNull();
    expect(chord({ key: "z", code: "KeyZ", ctrlKey: true, altKey: true })).toBeNull();
    expect(chord({ key: "x", code: "KeyX", ctrlKey: true })).toBeNull();
  });
});
