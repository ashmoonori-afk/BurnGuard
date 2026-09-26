import { expect, test } from "bun:test";
import { parseComposerDraft, restoredComposerDraft } from "../src/components/chat/useComposerDraft";

function stored() {
  const image = new File(["png"], "hero.png", { type: "image/png" });
  const draft = parseComposerDraft({ text: "old", items: [{ status: "ready", file: image, role: "ordinary_content" }] });
  if (draft === null) throw new TypeError("expected a stored draft");
  return { draft, image };
}

test("Given a stored draft and a non-empty initial text When the composer draft restores Then the initial text wins and the stored attachments survive", () => {
  const { draft, image } = stored();

  const restored = restoredComposerDraft(draft, "Create `about.html` linked from `index.html`");

  expect(restored.text).toBe("Create `about.html` linked from `index.html`");
  expect(restored.items).toHaveLength(1);
  expect(restored.items[0]).toMatchObject({ status: "ready", file: image });
});

test("Given a stored draft and no initial text When the composer draft restores Then the stored draft is used as it was", () => {
  const { draft } = stored();
  expect(restoredComposerDraft(draft, "")).toBe(draft);
});

test("Given no stored draft When the composer draft restores Then it starts from the initial text alone", () => {
  expect(restoredComposerDraft(undefined, "hello")).toEqual({ text: "hello", items: [] });
});

test("Given the draft hook source When scanned Then the restore effect depends on the session only, so a later prefill cannot re-run it", async () => {
  const source = await Bun.file(new URL("../src/components/chat/useComposerDraft.ts", import.meta.url)).text();
  expect(source).not.toContain("[sessionId, initialText]");
  expect(source).toContain("restoredComposerDraft(");
});
