import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("macOS native file input bridge", () => {
  test("wires WKWebView file inputs to a native open panel", async () => {
    const source = await readFile(path.join(import.meta.dir, "main.swift"), "utf8");

    expect(source).toMatch(/WKUIDelegate/);
    expect(source).toMatch(/webView\.uiDelegate\s*=\s*self/);
    expect(source).toMatch(/runOpenPanelWith parameters:\s*WKOpenPanelParameters/);
    expect(source).toMatch(/completionHandler:\s*@escaping \(\[URL\]\?\) -> Void/);
  });
});

const source = await readFile(path.join(import.meta.dir, "main.swift"), "utf8");

/** The brace-balanced body that follows the first occurrence of `signature` in main.swift. */
function body(signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature}`);
  const open = source.indexOf("{", start);
  for (let index = open, depth = 0; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`Unbalanced ${signature}`);
}

describe("macOS service pipes", () => {
  test("Given both service pipe handlers When availableData is empty Then each handler clears its readabilityHandler", () => {
    const service = body("private func startService()");
    const stdout = service.slice(service.indexOf("\n        output.fileHandleForReading.readabilityHandler"), service.indexOf("errorOutput.fileHandleForReading.readabilityHandler"));
    const stderr = service.slice(service.indexOf("errorOutput.fileHandleForReading.readabilityHandler"), service.indexOf("process.terminationHandler"));
    for (const handler of [stdout, stderr]) expect(handler).toMatch(/\.isEmpty \{ handle\.readabilityHandler = nil/);
  });
});
