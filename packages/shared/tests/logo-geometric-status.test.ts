import { describe, expect, test } from "bun:test";
import { LogoGeometricStatusError, parseLogoGeometricStatusV1 } from "../src/logo-geometric-status";

const SHA = "a".repeat(64);
const geometric = {
  schema_version: 1,
  method: "geometric",
  answers: { schema_version: 1, parts: { choice: "symbol" }, direction: { other: "Calm and round" } },
  plan: [{ step: "symbol", status: "awaiting_review" }],
  available_steps: ["symbol"],
  records: { symbol: SHA, wordmark: null, lockup: null },
  symbol_review: { passed: false, findings: ["near_touch", "sliver"] },
};

function refusedAt(input: unknown): string {
  try { parseLogoGeometricStatusV1(input); }
  catch (error) {
    if (error instanceof LogoGeometricStatusError) return error.path;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("parseLogoGeometricStatusV1", () => {
  test("Given a raster or a full geometric status When parsed Then it comes back unchanged", () => {
    expect(parseLogoGeometricStatusV1({ schema_version: 1, method: "raster" })).toEqual({ schema_version: 1, method: "raster" });
    expect(parseLogoGeometricStatusV1(geometric)).toEqual(geometric as never);
    expect(parseLogoGeometricStatusV1({ ...geometric, answers: null, plan: [], records: { symbol: null, wordmark: null, lockup: null }, symbol_review: null }))
      .toMatchObject({ answers: null, symbol_review: null });
  });

  test("Given an extra or missing key When parsed Then the method is refused", () => {
    expect(refusedAt({ schema_version: 1, method: "raster", answers: null })).toBe("method");
    expect(refusedAt({ ...geometric, extra: true })).toBe("method");
    const { available_steps: _dropped, ...withoutSteps } = geometric;
    expect(refusedAt(withoutSteps)).toBe("method");
    expect(refusedAt({ ...geometric, schema_version: 2 })).toBe("schema_version");
  });

  test("Given an unknown or repeated value in a list When parsed Then the exact field is named", () => {
    expect(refusedAt({ ...geometric, plan: [{ step: "symbol", status: "awaiting_review" }, { step: "symbol", status: "next" }] })).toBe("plan");
    expect(refusedAt({ ...geometric, plan: [{ step: "symbol", status: "maybe" }] })).toBe("plan.0.status");
    expect(refusedAt({ ...geometric, available_steps: ["symbol", "symbol"] })).toBe("available_steps");
    expect(refusedAt({ ...geometric, available_steps: ["badge"] })).toBe("available_steps.0");
    expect(refusedAt({ ...geometric, symbol_review: { passed: false, findings: ["wobble"] } })).toBe("symbol_review.findings.0");
    expect(refusedAt({ ...geometric, symbol_review: { passed: false, findings: ["sliver", "sliver"] } })).toBe("symbol_review.findings");
  });

  test("Given a malformed hash, answers or review When parsed Then it is refused", () => {
    expect(refusedAt({ ...geometric, records: { symbol: "A".repeat(64), wordmark: null, lockup: null } })).toBe("records.symbol");
    expect(refusedAt({ ...geometric, records: { symbol: SHA, wordmark: null } })).toBe("records");
    expect(refusedAt({ ...geometric, answers: { schema_version: 1, parts: { choice: "badge" }, direction: { choice: "auto" } } })).toBe("answers");
    expect(refusedAt({ ...geometric, symbol_review: { passed: "yes", findings: [] } })).toBe("symbol_review");
  });
});
