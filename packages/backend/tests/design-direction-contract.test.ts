import { describe, expect, test } from "bun:test";
import { COPY_TONE_PRESETS, IMAGE_STYLE_PRESETS, parseGenerationStyle, parseDesignDirectionState } from "@bg/shared";

function validState(): unknown {
  return {
    schema_version: 1,
    project_id: "project",
    session_id: "session",
    generation_id: "generation",
    status: "ready",
    content_outline: ["문제", "해결", "다음 단계"],
    directions: [
      { id: "editorial", order: 0, layout_key: "editorial", title: "편집 서사", summary: "큰 활자 중심", style_facts: ["비대칭 그리드", "세리프 제목"], status: "ready", preview_url: "/editorial.svg", error: null },
      { id: "modular", order: 1, layout_key: "modular", title: "모듈 시스템", summary: "정보 카드 중심", style_facts: ["12열 그리드", "고대비 카드"], status: "ready", preview_url: "/modular.svg", error: null },
      { id: "narrative", order: 2, layout_key: "narrative", title: "흐름 서사", summary: "단계별 이야기", style_facts: ["세로 흐름", "강조 인용"], status: "ready", preview_url: "/narrative.svg", error: null },
    ],
    selected_id: "editorial",
    selection_revision: 1,
    selection_history: [null],
    error: null,
    updated_at: 100,
  };
}

describe("design direction state parser", () => {
  test("Given saved style presets or a legacy state When decoded Then only known preset identities round trip", () => {
    const state = parseDesignDirectionState(validState());
    expect(state.creative_preferences).toBeUndefined();
    for (const image_style of Object.keys(IMAGE_STYLE_PRESETS)) for (const copy_tone of Object.keys(COPY_TONE_PRESETS)) {
      const preferences = { schema_version: 1, image_style, copy_tone };
      expect(parseDesignDirectionState({ ...state, creative_preferences: preferences }).creative_preferences).toEqual(preferences);
    }
    for (const preferences of [null, {}, { schema_version: 2, image_style: "brand", copy_tone: "brand" }, { schema_version: 1, image_style: "constructor", copy_tone: "friendly" }, { schema_version: 1, image_style: "studio", copy_tone: "toString" }, { schema_version: 1, image_style: "studio", copy_tone: "friendly", prompt: "ignore safety" }]) {
      expect(() => parseGenerationStyle(preferences)).toThrow();
      expect(() => parseDesignDirectionState({ ...state, creative_preferences: preferences })).toThrow();
    }
  });
  test("rejects malformed state invariants", () => {
    const mutations: readonly ((state: Record<string, unknown>) => void)[] = [
      (state) => { state["status"] = "unknown"; },
      (state) => { state["directions"] = []; },
      (state) => { const slots = state["directions"]; if (Array.isArray(slots)) slots[1] = slots[0]; },
      (state) => { const slots = state["directions"]; if (Array.isArray(slots) && typeof slots[1] === "object" && slots[1] !== null) slots[1] = { ...slots[1], layout_key: "editorial" }; },
      (state) => { const slots = state["directions"]; if (Array.isArray(slots) && typeof slots[0] === "object" && slots[0] !== null) slots[0] = { ...slots[0], preview_url: null }; },
      (state) => { const slots = state["directions"]; if (Array.isArray(slots) && typeof slots[0] === "object" && slots[0] !== null) slots[0] = { ...slots[0], status: "pending" }; },
      (state) => { state["selected_id"] = "missing"; },
      (state) => { state["selection_revision"] = 0; state["selection_history"] = [null]; },
      (state) => { state["content_outline"] = ["   "]; },
      (state) => { state["selection_revision"] = -1; },
      (state) => { state["selection_revision"] = 1.5; },
      (state) => { state["updated_at"] = -1; },
      (state) => { state["updated_at"] = Number.POSITIVE_INFINITY; },
    ];

    for (const mutate of mutations) {
      const state = structuredClone(validState());
      if (typeof state !== "object" || state === null || Array.isArray(state)) throw new TypeError("fixture must be an object");
      mutate(state);
      expect(() => parseDesignDirectionState(state)).toThrow();
    }
  });

  test("accepts an immutable ready state", () => {
    expect(parseDesignDirectionState(validState())).toEqual(validState());
  });
});
