import { describe, expect, test } from "bun:test";
import { UpgradeContractError } from "../src/contract-parser";
import { LOGO_TYPES } from "../src/logo";
import {
  LOGO_GEOMETRIC_NOTE_MAX,
  LOGO_GEOMETRIC_OTHER_MAX,
  LOGO_GEOMETRIC_TAG,
  logoGeometricPlan,
  logoMethodFor,
  parseLogoGeometricAction,
  parseLogoGeometricAnswersV1,
  resolveLogoGeometricTurn,
  serializeLogoGeometricAnswers,
  type LogoGeometricActionV1,
  type LogoGeometricAnswersV1,
  type LogoGeometricFilesState,
  type LogoGeometricStep,
  type LogoGeometricStepFiles,
} from "../src/logo-geometric-flow";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const both: LogoGeometricAnswersV1 = { schema_version: 1, parts: { choice: "symbol_wordmark" }, direction: { choice: "auto" } };
const symbolOnly: LogoGeometricAnswersV1 = { schema_version: 1, parts: { choice: "symbol" }, direction: { other: "Sharp, like a cut stencil" } };
const wordmarkOnly: LogoGeometricAnswersV1 = { schema_version: 1, parts: { choice: "wordmark" }, direction: { choice: "bold_abstract" } };

const none: LogoGeometricStepFiles = { record_sha256: null, approved_sha256: null };
function state(answers: LogoGeometricAnswersV1 | null, steps: Partial<Record<LogoGeometricStep, LogoGeometricStepFiles>> = {}): LogoGeometricFilesState {
  return { answers, steps: { symbol: none, wordmark: none, lockup: none, ...steps } };
}
const sentinel = (body: unknown): string => `<${LOGO_GEOMETRIC_TAG}>${JSON.stringify(body)}</${LOGO_GEOMETRIC_TAG}>\nshown line`;

describe("logoMethodFor", () => {
  test("Given every logo type When the method is chosen Then only pictorial and mascot stay raster", () => {
    const raster = LOGO_TYPES.filter((type) => logoMethodFor(type) === "raster");
    expect(raster).toEqual(["pictorial", "mascot"]);
  });
});

describe("parseLogoGeometricAction", () => {
  test("Given each well-formed sentinel When parsed Then the action comes back exactly", () => {
    const actions: LogoGeometricActionV1[] = [
      { action: "answer", parts: { choice: "symbol_wordmark" }, direction: { other: "Round and calm" } },
      { action: "approve", step: "symbol", record_sha256: A },
      { action: "revise", step: "wordmark", record_sha256: B, note: "Make the stems heavier" },
    ];
    for (const action of actions) expect(parseLogoGeometricAction(sentinel(action))).toEqual(action);
  });

  test("Given a message with no sentinel or the raster flow's tag When parsed Then there is no action", () => {
    expect(parseLogoGeometricAction("Make it rounder")).toBeNull();
    expect(parseLogoGeometricAction(`<burnguard-logo-action-v1>{"action":"ideate"}</burnguard-logo-action-v1>`)).toBeNull();
  });

  test("Given malformed sentinels When parsed Then each is treated as absent", () => {
    const malformed: unknown[] = [
      { action: "answer", parts: { choice: "everything" }, direction: { choice: "auto" } },
      { action: "answer", parts: { choice: "symbol", other: "x" }, direction: { choice: "auto" } },
      { action: "answer", parts: { other: "   " }, direction: { choice: "auto" } },
      { action: "answer", parts: { other: "x".repeat(LOGO_GEOMETRIC_OTHER_MAX + 1) }, direction: { choice: "auto" } },
      { action: "answer", parts: { other: "tab\u0007bell" }, direction: { choice: "auto" } },
      { action: "answer", parts: { choice: "symbol" } },
      { action: "approve", step: "symbol", record_sha256: "A".repeat(64) },
      { action: "approve", step: "symbol", record_sha256: A.slice(1) },
      { action: "approve", step: "tagline", record_sha256: A },
      { action: "approve", step: "symbol", record_sha256: A, note: "extra" },
      { action: "revise", step: "symbol", record_sha256: A },
      { action: "revise", step: "symbol", record_sha256: A, note: "x".repeat(LOGO_GEOMETRIC_NOTE_MAX + 1) },
      { action: "select", step: "symbol", record_sha256: A },
      ["approve"],
    ];
    for (const body of malformed) expect(parseLogoGeometricAction(sentinel(body))).toBeNull();
    expect(parseLogoGeometricAction(`<${LOGO_GEOMETRIC_TAG}>{not json</${LOGO_GEOMETRIC_TAG}>`)).toBeNull();
  });
});

describe("answers file", () => {
  test("Given answers When serialised and parsed again Then they round-trip byte for byte", () => {
    for (const answers of [both, symbolOnly, wordmarkOnly]) {
      const bytes = serializeLogoGeometricAnswers(answers);
      expect(parseLogoGeometricAnswersV1(bytes)).toEqual(answers);
      expect(serializeLogoGeometricAnswers(parseLogoGeometricAnswersV1(bytes))).toBe(bytes);
    }
  });

  test("Given an answers file with an unknown field or a bad choice When parsed Then it is refused", () => {
    expect(() => parseLogoGeometricAnswersV1({ ...both, extra: 1 })).toThrow(UpgradeContractError);
    expect(() => parseLogoGeometricAnswersV1({ ...both, parts: { choice: "all" } })).toThrow(UpgradeContractError);
    expect(() => parseLogoGeometricAnswersV1({ ...both, schema_version: 2 })).toThrow(UpgradeContractError);
  });
});

describe("resolveLogoGeometricTurn", () => {
  test("Given no answers When any message arrives without answering Then the turn is refused as unanswered", () => {
    expect(resolveLogoGeometricTurn(state(null), null)).toEqual({ kind: "refused", code: "unanswered" });
    expect(resolveLogoGeometricTurn(state(null), { action: "approve", step: "symbol", record_sha256: A })).toEqual({ kind: "refused", code: "unanswered" });
  });

  test("Given an answer When resolved Then the first step of the chosen parts is made with those answers", () => {
    const answer = (parts: LogoGeometricAnswersV1["parts"]) => resolveLogoGeometricTurn(state(null), { action: "answer", parts, direction: { choice: "auto" } });
    expect(answer({ choice: "symbol_wordmark" })).toMatchObject({ kind: "make", step: "symbol", note: null, approve: null });
    expect(answer({ choice: "symbol" })).toMatchObject({ kind: "make", step: "symbol" });
    expect(answer({ choice: "wordmark" })).toMatchObject({ kind: "make", step: "wordmark" });
    expect(answer({ other: "A monogram and a tagline" })).toMatchObject({ kind: "make", step: "symbol", answers: { parts: { other: "A monogram and a tagline" } } });
  });

  test("Given a finished flow When the questions are answered again Then it starts over at the first step", () => {
    const done = state(both, { symbol: { record_sha256: A, approved_sha256: A }, wordmark: { record_sha256: B, approved_sha256: B }, lockup: { record_sha256: C, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(done, { action: "answer", parts: { choice: "wordmark" }, direction: { choice: "auto" } })).toMatchObject({ kind: "make", step: "wordmark" });
  });

  test("Given a plain message When the current step is unmade or shown Then that step is made again with no note", () => {
    expect(resolveLogoGeometricTurn(state(both), null)).toEqual({ kind: "make", step: "symbol", answers: both, note: null, approve: null });
    const shown = state(both, { symbol: { record_sha256: A, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(shown, null)).toEqual({ kind: "make", step: "symbol", answers: both, note: null, approve: null });
  });

  test("Given a shown symbol When it is revised with its current hash Then the symbol is made again with the note", () => {
    const shown = state(both, { symbol: { record_sha256: A, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(shown, { action: "revise", step: "symbol", record_sha256: A, note: "Open the counters" }))
      .toEqual({ kind: "make", step: "symbol", answers: both, note: "Open the counters", approve: null });
  });

  test("Given a shown symbol When it is approved with its current hash Then the approval is recorded and the wordmark is made", () => {
    const shown = state(both, { symbol: { record_sha256: A, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(shown, { action: "approve", step: "symbol", record_sha256: A }))
      .toEqual({ kind: "make", step: "wordmark", answers: both, note: null, approve: { step: "symbol", record_sha256: A } });
  });

  test("Given an approved wordmark When it is approved Then the lockup is made next", () => {
    const shown = state(both, { symbol: { record_sha256: A, approved_sha256: A }, wordmark: { record_sha256: B, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(shown, { action: "approve", step: "wordmark", record_sha256: B }))
      .toMatchObject({ kind: "make", step: "lockup", approve: { step: "wordmark", record_sha256: B } });
  });

  test("Given a symbol-only flow When the symbol is approved Then the flow completes with that approval", () => {
    const shown = state(symbolOnly, { symbol: { record_sha256: A, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(shown, { action: "approve", step: "symbol", record_sha256: A }))
      .toEqual({ kind: "complete", approve: { step: "symbol", record_sha256: A } });
  });

  test("Given an approve or revise naming a hash that is no longer on disk When resolved Then it is refused as stale", () => {
    const shown = state(both, { symbol: { record_sha256: B, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(shown, { action: "approve", step: "symbol", record_sha256: A })).toEqual({ kind: "refused", code: "stale_record" });
    expect(resolveLogoGeometricTurn(shown, { action: "revise", step: "symbol", record_sha256: A, note: "x" })).toEqual({ kind: "refused", code: "stale_record" });
  });

  test("Given the symbol is current When the wordmark is approved Then the turn is refused as out of order", () => {
    const shown = state(both, { symbol: { record_sha256: A, approved_sha256: null }, wordmark: { record_sha256: B, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(shown, { action: "approve", step: "wordmark", record_sha256: B })).toEqual({ kind: "refused", code: "out_of_order" });
  });

  test("Given every step done When a message or action arrives Then the turn is refused as complete", () => {
    const done = state(both, { symbol: { record_sha256: A, approved_sha256: A }, wordmark: { record_sha256: B, approved_sha256: B }, lockup: { record_sha256: C, approved_sha256: null } });
    expect(resolveLogoGeometricTurn(done, null)).toEqual({ kind: "refused", code: "flow_complete" });
    expect(resolveLogoGeometricTurn(done, { action: "revise", step: "symbol", record_sha256: A, note: "x" })).toEqual({ kind: "refused", code: "flow_complete" });
  });

  test("Given an approved symbol rewritten on disk When resolved Then the symbol is current again and later approvals no longer count", () => {
    const stale = state(both, { symbol: { record_sha256: B, approved_sha256: A }, wordmark: { record_sha256: C, approved_sha256: C } });
    expect(resolveLogoGeometricTurn(stale, null)).toMatchObject({ kind: "make", step: "symbol" });
    expect(resolveLogoGeometricTurn(stale, { action: "approve", step: "wordmark", record_sha256: C })).toEqual({ kind: "refused", code: "out_of_order" });
  });
});

describe("logoGeometricPlan", () => {
  test("Given no answers When the plan is derived Then it is empty", () => {
    expect(logoGeometricPlan(state(null))).toEqual([]);
  });

  test("Given each point of the flow When the plan is derived Then every step has the matching status", () => {
    expect(logoGeometricPlan(state(both))).toEqual([
      { step: "symbol", status: "next" }, { step: "wordmark", status: "pending" }, { step: "lockup", status: "pending" },
    ]);
    expect(logoGeometricPlan(state(both, { symbol: { record_sha256: A, approved_sha256: null } }))).toEqual([
      { step: "symbol", status: "awaiting_review" }, { step: "wordmark", status: "pending" }, { step: "lockup", status: "pending" },
    ]);
    expect(logoGeometricPlan(state(both, { symbol: { record_sha256: A, approved_sha256: A }, wordmark: { record_sha256: B, approved_sha256: B } }))).toEqual([
      { step: "symbol", status: "done" }, { step: "wordmark", status: "done" }, { step: "lockup", status: "next" },
    ]);
    expect(logoGeometricPlan(state(both, { symbol: { record_sha256: A, approved_sha256: A }, wordmark: { record_sha256: B, approved_sha256: B }, lockup: { record_sha256: C, approved_sha256: null } })))
      .toEqual([{ step: "symbol", status: "done" }, { step: "wordmark", status: "done" }, { step: "lockup", status: "done" }]);
    expect(logoGeometricPlan(state(wordmarkOnly, { symbol: { record_sha256: A, approved_sha256: null } }))).toEqual([{ step: "wordmark", status: "next" }]);
  });

  test("Given a rewritten approved symbol When the plan is derived Then the symbol awaits review and nothing after it counts as done", () => {
    expect(logoGeometricPlan(state(both, { symbol: { record_sha256: B, approved_sha256: A }, wordmark: { record_sha256: C, approved_sha256: C } }))).toEqual([
      { step: "symbol", status: "awaiting_review" }, { step: "wordmark", status: "pending" }, { step: "lockup", status: "pending" },
    ]);
  });
});
