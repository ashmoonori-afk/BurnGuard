import { expect, test } from "bun:test";
import {
  ORACLE_MAX_BYTES, ORACLE_MAX_CASES, OracleError, parseOracleCases, readOracleCases,
} from "./theme-engine-oracle";
import type { OracleCase } from "./theme-engine-oracle";

const gray: OracleCase = { id: "gray", gamut: "display-p3", l: 0.5, c: 0, h: null, expectedRgb: [0.5, 0.5, 0.5] };

test("Given opaque endpoint and gray cases When parsed Then their precision and gamut survive", () => {
  // Given
  const cases: readonly OracleCase[] = [
    { ...gray, id: "black", l: 0, expectedRgb: [0, 0, 0] },
    { ...gray, id: "white", l: 1, expectedRgb: [1, 1, 1] },
    gray,
    { ...gray, id: "precise", gamut: "srgb", l: 0.500000000001, c: 0.000000000001, h: -720.25 },
  ];
  // When
  const parsed = parseOracleCases(cases);
  // Then
  expect(parsed).toEqual(cases);
});

test.each([
  { ...gray, alpha: 0.5 },
  { ...gray, diagnostic: "/private/provider" },
  { ...gray, id: "../private" },
  { ...gray, gamut: "p3" },
  { ...gray, l: NaN },
  { ...gray, l: -0.001 },
  { ...gray, l: 1.001 },
  { ...gray, c: Infinity },
  { ...gray, c: -0.001 },
  { ...gray, c: 0.1 },
  { ...gray, h: Infinity },
  { ...gray, h: "none" },
  { ...gray, expectedRgb: [0, 0] },
  { ...gray, expectedRgb: [0, 0, 0, 1] },
  { ...gray, expectedRgb: [0, -1, 0] },
  { ...gray, expectedRgb: [0, 0, 1.001] },
  { ...gray, expectedRgb: [0, NaN, 0] },
])("Given an invalid case %# When parsed Then no case is accepted", row => {
  // Given / When / Then
  expect(() => parseOracleCases([row])).toThrow(OracleError);
});

test.each([{ value: [] }, { value: [gray, gray] }, { value: null }, { value: { cases: [gray] } }])(
  "Given an invalid case collection %# When parsed Then the contract fails", ({ value }) => {
    expect(() => parseOracleCases(value)).toThrow(OracleError);
  },
);

test("Given the full two-gamut case budget When parsed Then every identifier survives", () => {
  const cases = Array.from({ length: ORACLE_MAX_CASES }, (_, i) => ({ ...gray, id: `case-${i}` }));
  const parsed = parseOracleCases(cases);
  expect(parsed.map(row => row.id)).toEqual(cases.map(row => row.id));
});

test("Given too many cases When parsed Then allocation is refused with a limit code", () => {
  const cases = Array.from({ length: ORACLE_MAX_CASES + 1 }, (_, i) => ({ ...gray, id: `case-${i}` }));
  expect(() => parseOracleCases(cases)).toThrow("ORACLE_LIMIT");
});

test("Given JSON split across UTF8 chunks When read Then case data is decoded once", async () => {
  const bytes = Buffer.from(JSON.stringify([gray]));
  async function* source() { yield bytes.subarray(0, 17); yield bytes.subarray(17); }
  const cases = await readOracleCases(source());
  expect(cases).toEqual([gray]);
});

test("Given an oversized stream When read Then it stops before acquiring the next chunk", async () => {
  let continued = false;
  async function* source() {
    yield new Uint8Array(ORACLE_MAX_BYTES);
    yield new Uint8Array(1);
    continued = true;
  }
  await expect(readOracleCases(source())).rejects.toMatchObject({ code: "ORACLE_LIMIT" });
  expect(continued).toBe(false);
});

test("Given malformed JSON When read Then failure contains only a machine code", async () => {
  async function* source() { yield Buffer.from('{"private":'); }
  await expect(readOracleCases(source())).rejects.toMatchObject({ code: "ORACLE_INPUT", message: "ORACLE_INPUT" });
});
