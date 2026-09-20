import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectImageOutputHashes } from "../src/adapters/codex/image-outputs";
import { mapCodexEnvelope } from "../src/adapters/codex/event-mapping";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const SHA = createHash("sha256").update(PNG).digest("hex");

describe("codex image-tool output hashes", () => {
  test("Given a base64 PNG anywhere in the item Then its sha256 is collected once", () => {
    const value = { type: "image_generation_call", status: "completed", result: PNG.toString("base64"), nested: { data_url: `data:image/png;base64,${PNG.toString("base64")}` } };
    expect(collectImageOutputHashes(value, undefined)).toEqual([SHA]);
  });

  test("Given a .png path inside the project Then the file bytes are hashed; outside or missing paths are ignored", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bg-image-outputs-"));
    try {
      writeFileSync(path.join(dir, "out.png"), PNG);
      expect(collectImageOutputHashes({ output_path: "out.png", other: "../escape.png", missing: "nope.png" }, dir)).toEqual([SHA]);
      expect(collectImageOutputHashes({ output_path: path.join(dir, "out.png") }, dir)).toEqual([SHA]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("Given prose, non-PNG base64 and deep nesting Then nothing is collected", () => {
    const deep = { a: { b: { c: { d: { e: { f: PNG.toString("base64") } } } } } };
    expect(collectImageOutputHashes({ text: "a logo", blob: Buffer.from("hello world!!").toString("base64") }, undefined)).toEqual([]);
    expect(collectImageOutputHashes(deep, undefined)).toEqual([]);
  });

  test("Given a completed image_generation item When mapped Then tool.finished carries image_sha256", () => {
    const events = mapCodexEnvelope({ type: "item.completed", item: { id: "i1", type: "image_generation", status: "completed", result: PNG.toString("base64") } }, { turnId: "t", projectDir: undefined } as never);
    expect(events).toMatchObject([{ type: "tool.finished", tool: "image_generation", ok: true, output: { image_sha256: [SHA] } }]);
  });
});
