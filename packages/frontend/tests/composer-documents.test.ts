import { expect, test } from "bun:test";

test("Given the composer documents hook source When scanned Then the save effect depends on the id-derived key, not the files array, so a role toggle cannot re-save (UXW-21)", async () => {
  const source = await Bun.file(new URL("../src/components/chat/useComposerDocuments.ts", import.meta.url)).text();
  const deps = source.match(/\}, \[([^\]]*)\]\);/)?.[1]?.split(",").map((dep) => dep.trim()) ?? [];
  expect(deps).toContain("key");
  expect(deps).not.toContain("files");
});
