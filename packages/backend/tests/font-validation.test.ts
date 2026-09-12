import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { GlobalFonts } from "@napi-rs/canvas";
import { isValidFontData } from "../src/services/font-validation";

test("actual WOFF2 fonts decode without leaving validation families registered", async () => {
  const bytes = await readFile(new URL("../../../assets/fonts/Figtree.woff2", import.meta.url));
  const before = GlobalFonts.families;
  expect(await isValidFontData(bytes)).toBe(true);
  expect(GlobalFonts.families).toEqual(before);
});

test("validation preserves an already registered copy of the same font", async () => {
  const bytes = await readFile(new URL("../../../assets/fonts/Figtree.woff2", import.meta.url));
  const existing = GlobalFonts.register(bytes, "Existing validation fixture");
  if (!existing) throw new Error("Fixture font could not be registered");
  try {
    expect(await isValidFontData(bytes)).toBe(true);
    expect(GlobalFonts.has("Existing validation fixture")).toBe(true);
  } finally {
    GlobalFonts.remove(existing);
  }
});

test("wrong signatures and corrupt payloads with supported signatures are rejected", async () => {
  expect(await isValidFontData(Buffer.from("invalid fixture bytes"))).toBe(false);
  expect(await isValidFontData(new Uint8Array())).toBe(false);
  for (const signature of ["wOF2", "wOFF", "OTTO", "true"]) {
    const corrupt = Buffer.alloc(64);
    corrupt.write(signature);
    expect(await isValidFontData(corrupt)).toBe(false);
  }
});
