import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GenerationControls from "../src/components/settings/GenerationControls";
import { settingsMessages } from "../src/i18n/messages/settings";

/**
 * P2. The controls say that guidance follows the selection, and say only that: preset identifiers,
 * block text, envelope tags and prompt JSON are backend-internal and must never reach the UI.
 */
test("Given the generation controls When rendered Then the adapted-guidance hint shows without exposing internals", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(GenerationControls, {
        backendId: "codex",
        value: { model: "gpt-5.6-luna", effort: "low", provider: "native", vanilla: false },
        onChange: () => {},
      }),
    ),
  );

  // Shipped-copy equality against the catalog, so rewording the sentence does not break this test.
  expect(html).toContain(settingsMessages["settings.taskGuidanceAdapts"].ko);

  for (const internal of [
    "burnguard-task-guidance",
    "burnguard-model-guidance",
    "task-work-v1",
    "codex/native/",
    "preset_id",
    "block_sha256",
  ]) {
    expect(html).not.toContain(internal);
  }
});
