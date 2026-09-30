import { describe, expect, test } from "bun:test";
import type { FileInfo } from "@bg/shared";
import { loadFilePreview } from "../src/components/files/FilePreview";

const MIB = 1024 * 1024;

describe("CANVAS-3 truncated text preview", () => {
  test("Given a text file whose 1 MiB cut falls inside a multi-byte character When previewed Then the truncated text does not end in a replacement character", async () => {
    const encoder = new TextEncoder();
    const body = new Uint8Array([...encoder.encode("a".repeat(MIB - 1)), ...encoder.encode("\uD55C"), ...encoder.encode("tail")]);
    const file = { rel_path: "notes.txt", category: "document" } as FileInfo;
    const fetchFile = async () => new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
    const preview = await loadFilePreview("p1", file, new AbortController().signal, fetchFile);
    expect(preview.kind).toBe("text");
    if (preview.kind !== "text") return;
    expect(preview.truncated).toBe(true);
    expect(preview.text.endsWith("\uFFFD")).toBe(false);
  });
});
