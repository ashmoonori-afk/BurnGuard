import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.join(import.meta.dir, "../src");

test("Given canvas authoring chrome When audited Then selection states use semantic tokens", async () => {
  const relativePaths = [
    "components/canvas/SelectorOverlay.tsx",
    "components/canvas/EditLayer.tsx",
    "components/canvas/CommentLayer.tsx",
    "components/modes/CommentPanel.tsx",
    "components/modes/DrawPanel.tsx",
    "components/modes/EditPanel.tsx",
  ];
  const sources = await Promise.all(
    relativePaths.map(async (relative) => ({
      relative,
      source: await readFile(path.join(sourceRoot, relative), "utf8"),
    })),
  );

  for (const { relative, source } of sources) {
    expect(
      source,
      `${relative} contains a raw authoring-state palette class`,
    ).not.toMatch(/\b(?:amber|blue|orange|sky)-\d{2,3}\b/);
  }
  expect(sources.at(-1)?.source).toContain('variant="cta"');
});
