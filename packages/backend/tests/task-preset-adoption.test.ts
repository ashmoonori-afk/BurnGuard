import { expect, test } from "bun:test";
import type { GenerationOptions } from "@bg/shared";
import { selectTaskPreset } from "../src/harness/prompt-model-context";
import { TASK_PRESET_REGISTRY, type PresetRegistry } from "../src/harness/prompt-task-presets";
import type { AdoptionTable, CombinationAdoption } from "../src/harness/task-preset-adoptions";

const BASE_PRESET_ID = "codex/native/gpt-5.6-luna/v1";

const adoption = (overrides: Partial<CombinationAdoption> = {}): CombinationAdoption => ({
  route: "codex/native",
  base_preset_id: BASE_PRESET_ID,
  effort: "low",
  deliverable: "prototype",
  status: "validated",
  revision_id: "codex/native/gpt-5.6-luna/v2",
  wording: "sol",
  example: "off",
  content_sha256: "a".repeat(64),
  adoption_evidence_id: "ex-test",
  enabled: true,
  ...overrides,
});

const withAdoptions = (entry: CombinationAdoption): PresetRegistry => {
  const table: AdoptionTable = {
    [entry.route]: { [entry.base_preset_id]: { low: { [entry.deliverable]: entry } } },
  };
  return { ...TASK_PRESET_REGISTRY, adoptions: table };
};

const options = (effort: GenerationOptions["effort"]): GenerationOptions =>
  ({ model: "gpt-5.6-luna", effort, provider: "native", vanilla: false });

test("Given an enabled adoption When selecting that exact combination Then it is validated", () => {
  const registry = withAdoptions(adoption());
  const selected = selectTaskPreset("codex", options("low"), "prototype", registry);
  expect(selected.status).toBe("validated");
  expect(selected.preset_id).toBe("codex/native/gpt-5.6-luna/v2");
  // The adopted wording replaces the base wording block.
  expect(selected.blocks[2].id).toBe("wording-sol-v1");
  // The user's own selection is never rewritten by adoption.
  expect(selected.model).toBe("gpt-5.6-luna");
  expect(selected.effort).toBe("low");
});

test("Given a disabled adoption When selecting Then the base draft preset is used unchanged", () => {
  const registry = withAdoptions(adoption({ enabled: false }));
  const selected = selectTaskPreset("codex", options("low"), "prototype", registry);
  expect(selected.status).toBe("draft");
  expect(selected.preset_id).toBe(BASE_PRESET_ID);
  expect(selected.blocks[2].id).toBe("wording-luna-v1");
});

test("Given an adoption for one cell When selecting neighbours Then they are not validated", () => {
  const registry = withAdoptions(adoption());
  // Same model and deliverable, different effort.
  const higher = selectTaskPreset("codex", options("high"), "prototype", registry);
  expect(higher.status).toBe("draft");
  expect(higher.preset_id).toBe(BASE_PRESET_ID);
  // Same model and effort, different deliverable.
  const deck = selectTaskPreset("codex", options("low"), "slide_deck", registry);
  expect(deck.status).toBe("draft");
  expect(deck.preset_id).toBe(BASE_PRESET_ID);
});

test("Given the shipped registry When selecting Then nothing is validated yet", () => {
  const selected = selectTaskPreset("codex", options("low"), "prototype");
  expect(selected.status).toBe("draft");
  expect(selected.preset_id).toBe(BASE_PRESET_ID);
});
