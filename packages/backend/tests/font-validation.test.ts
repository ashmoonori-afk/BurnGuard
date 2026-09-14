import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GlobalFonts } from "@napi-rs/canvas";
import { hasBoundedFontTables, isValidFontData } from "../src/services/font-validation";

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

test("WOFF directory budgets reject the 74-byte 1 GiB fixture before allocation", async () => {
  await isValidFontData(await readFile(new URL("../../../assets/fonts/Figtree.woff2", import.meta.url)));
  const bytes = Buffer.alloc(74);
  bytes.write("wOFF"); bytes.writeUInt32BE(0x10000, 4); bytes.writeUInt32BE(74, 8);
  bytes.writeUInt16BE(1, 12); bytes.writeUInt32BE(0x40000000, 16);
  bytes.write("cmap", 44); bytes.writeUInt32BE(64, 48); bytes.writeUInt32BE(10, 52); bytes.writeUInt32BE(0x40000000, 56);
  bytes[64] = 0x78; bytes[65] = 0x9c;
  const requests: number[] = [], Original = Uint8Array;
  globalThis.Uint8Array = new Proxy(Original, { construct(target, args, newTarget) {
    if (typeof args[0] === "number" && args[0] > 16_000_000) {
      requests.push(args[0]); throw new Error("Fixture blocked oversized allocation");
    }
    return Reflect.construct(target, args, newTarget);
  } });
  try {
    expect(await isValidFontData(bytes)).toBe(false);
    expect(requests).toEqual([]);
  } finally { globalThis.Uint8Array = Original; }
});

function woff2Directory(entries: readonly number[], count: number, expanded = 32): Buffer {
  const bytes = Buffer.alloc(48 + entries.length + 1);
  bytes.write("wOF2"); bytes.writeUInt32BE(0x10000, 4); bytes.writeUInt32BE(bytes.length, 8);
  bytes.writeUInt16BE(count, 12); bytes.writeUInt32BE(expanded, 16); bytes.writeUInt32BE(1, 20);
  Buffer.from(entries).copy(bytes, 48);
  return bytes;
}

test("WOFF2 preflight bounds original and transformed lengths, counts and variable integers", () => {
  expect(hasBoundedFontTables(woff2Directory([0, 4], 1))).toBe(true);
  const gib = [0x84, 0x80, 0x80, 0x80, 0];
  for (const bytes of [
    woff2Directory([0, ...gib], 1),
    woff2Directory([0x43, 4, ...gib], 1), // transformed hmtx
    woff2Directory([0x3f, ...Buffer.from("glyf"), 4, ...gib], 1),
    woff2Directory([0, 4], 0), woff2Directory([0, 4], 129),
    woff2Directory([0, 0x80, 4], 1), // noncanonical base128
    woff2Directory([0, 0x90, 0x80, 0x80, 0x80, 0], 1), // uint32 overflow
    woff2Directory([0, 0xff, 0xff, 0xff, 0xff, 0xff], 1),
    woff2Directory([0, 4, 0, 4], 2, 52), // duplicate table
    woff2Directory([11, 4, 1], 1), // transformed loca must be empty
    woff2Directory([0, 4], 2), // truncated directory
    woff2Directory([0, 4], 1, 64 * 1024 * 1024 + 1),
  ]) expect(hasBoundedFontTables(bytes)).toBe(false);
  const truncated = woff2Directory([0, 4], 1);
  truncated.writeUInt32BE(2, 20);
  expect(hasBoundedFontTables(truncated)).toBe(false);
});

test("WOFF preflight checks aggregate expanded bytes, table ranges and count before decoding", () => {
  const bytes = Buffer.alloc(88);
  bytes.write("wOFF"); bytes.writeUInt32BE(0x10000, 4); bytes.writeUInt32BE(bytes.length, 8);
  bytes.writeUInt16BE(2, 12); bytes.writeUInt32BE(52, 16);
  for (const [index, tag] of ["cmap", "name"].entries()) {
    const offset = 44 + index * 20;
    bytes.write(tag, offset); bytes.writeUInt32BE(84 + index * 2, offset + 4);
    bytes.writeUInt32BE(2, offset + 8); bytes.writeUInt32BE(4, offset + 12);
  }
  expect(hasBoundedFontTables(bytes)).toBe(true);
  const overlap = Buffer.from(bytes); overlap.writeUInt32BE(84, 68);
  expect(hasBoundedFontTables(overlap)).toBe(false);
  const outside = Buffer.from(bytes); outside.writeUInt32BE(88, 68);
  expect(hasBoundedFontTables(outside)).toBe(false);
  const aggregate = Buffer.from(bytes); aggregate.writeUInt32BE(40 * 1024 * 1024, 56); aggregate.writeUInt32BE(40 * 1024 * 1024, 76);
  expect(hasBoundedFontTables(aggregate)).toBe(false);
  const count = Buffer.from(bytes); count.writeUInt16BE(129, 12);
  expect(hasBoundedFontTables(count)).toBe(false);
});

test("every shipped WOFF2 remains within the directory budget", async () => {
  let count = 0;
  const directory = new URL("../../../assets/fonts/", import.meta.url);
  // A file URL pathname is `/C:/...` on Windows, which is not a filesystem path Bun.Glob can scan.
  for await (const file of new Bun.Glob("*.woff2").scan(fileURLToPath(directory))) {
    expect(hasBoundedFontTables(await readFile(new URL(file, directory)))).toBe(true);
    count++;
  }
  expect(count).toBeGreaterThan(0);
});
