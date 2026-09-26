import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BACKEND_IDS, type BackendDetectionResult } from "@bg/shared";
import { DetectionList } from "../src/components/errors/CliMissingModal";
import { BACKEND_LABELS } from "../src/lib/backend-display";

test("Given every backend missing When the CLI detection rows render Then each row carries the product display name rather than its raw id", () => {
  const detection: BackendDetectionResult = {
    backends: BACKEND_IDS.map((id) => ({ id, found: false, install_hint: `Install from https://example.test/${id}` })),
  };

  const html = renderToStaticMarkup(createElement(DetectionList, { detection }));

  for (const id of BACKEND_IDS) expect(html).toContain(BACKEND_LABELS[id]);
  expect(html).not.toContain(">gemini<");
  expect(html).not.toContain(">copilot<");
  expect(html).not.toContain(">claude code<");
  expect(html).not.toContain("capitalize");
});
