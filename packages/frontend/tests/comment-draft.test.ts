import { describe, expect, test } from "bun:test";
import { nextCommentDraft } from "../src/components/modes/CommentPanel";
import { COMMENT_DRAFT_KEY, readCommentDraft, restoredCommentDraft, writeCommentDraft } from "../src/lib/comment-draft";

describe("nextCommentDraft", () => {
  test("Given another panel saved newer text When this textarea is idle Then it synchronizes", () => {
    expect(nextCommentDraft("stale body", "new body", false)).toBe("new body");
  });

  test("Given another panel saved newer text When this textarea is actively editing Then its draft is preserved", () => {
    expect(nextCommentDraft("local edit", "new body", true)).toBe("local edit");
  });
});

describe("comment draft storage (F-UX-6)", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return { values, storage: () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }) };
  }

  test("Given an edit that differs from the saved body When it is written Then it is stored under the comment id and read back", () => {
    const { values, storage } = memoryStorage();
    writeCommentDraft("c1", "unsaved edit", "saved body", storage);
    expect(values.get(COMMENT_DRAFT_KEY("c1"))).toBe("unsaved edit");
    expect(readCommentDraft("c1", storage)).toBe("unsaved edit");
    expect(readCommentDraft("c2", storage)).toBeNull();
  });

  test("Given a stored draft When an edit equal to the saved body is written Then the stored copy is removed", () => {
    const { values, storage } = memoryStorage();
    writeCommentDraft("c1", "unsaved edit", "saved body", storage);
    writeCommentDraft("c1", "saved body", "saved body", storage);
    expect(values.has(COMMENT_DRAFT_KEY("c1"))).toBe(false);
  });

  test("Given blocked storage When a draft is read or written Then nothing throws and no draft is restored", () => {
    const blocked = () => { throw new DOMException("blocked", "SecurityError"); };
    expect(readCommentDraft("c1", blocked)).toBeNull();
    expect(() => writeCommentDraft("c1", "edit", "body", blocked)).not.toThrow();
  });

  test("Given a stored draft that differs from the server body When the editor remounts Then it starts from the draft and still needs saving", () => {
    expect(restoredCommentDraft("unsaved edit", "saved body")).toEqual({ body: "unsaved edit", dirty: true });
  });

  test("Given no stored draft or one the server already saved When the editor remounts Then it starts clean from the server body", () => {
    expect(restoredCommentDraft(null, "saved body")).toEqual({ body: "saved body", dirty: false });
    expect(restoredCommentDraft("saved body", "saved body")).toEqual({ body: "saved body", dirty: false });
  });

  test("Given the comment editor source When scanned Then a dirty draft is committed on pagehide and on a hidden page, and every edit is stored", async () => {
    const source = await Bun.file(new URL("../src/components/modes/CommentPanel.tsx", import.meta.url)).text();
    expect(source).toContain('window.addEventListener("pagehide", commitPending)');
    expect(source).toContain('document.addEventListener("visibilitychange", commitWhenHidden)');
    expect(source).toContain('document.visibilityState === "hidden"');
    expect(source).toContain("writeCommentDraft(comment.id, e.target.value, comment.body)");
    expect(source).toContain("restoredCommentDraft(readCommentDraft(comment.id), comment.body)");
  });
});
