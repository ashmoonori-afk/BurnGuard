import { expect, test } from "bun:test";
import type { GenerationOptions } from "@bg/shared";
import { panelGenerationFor } from "../src/lib/panel-generation";

const G: GenerationOptions = { model: "fixture-model", effort: "high", vanilla: false, provider: "commandcode" };

test("Given no stored composer draft When a panel send resolves its generation Then it is undefined so the backend applies the configured defaults", () => {
  expect(panelGenerationFor(null)).toBeUndefined();
  expect(panelGenerationFor({ text: "", items: [] })).toBeUndefined();
});

test("Given a stored draft with generation options When a panel send resolves its generation Then those exact options are sent", () => {
  expect(panelGenerationFor({ text: "", items: [], generation: G })).toBe(G);
});
