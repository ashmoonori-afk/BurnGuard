import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const shellRoot = path.join(import.meta.dir, "../../desktop-mac");
const source = await readFile(path.join(shellRoot, "main.swift"), "utf8");
const windowsSource = await readFile(path.join(import.meta.dir, "../../desktop-windows/Program.cs"), "utf8");

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

describe("macOS shell keeps the Windows shell's desktop contract", () => {
  test("Given the Windows shell pins pid and origin When the macOS shell consumes a readiness line Then it also validates pid and the loopback origin", () => {
    expect(windowsSource).toContain('Convert.ToInt32(data["pid"]) != service.Id');
    const consume = body("private func consumeServiceOutput(");
    expect(consume).toContain('message["pid"]');
    expect(consume).toContain("127.0.0.1");
  });

  test("Given the Windows shell forces BG_DEV=0 When the macOS shell builds the backend environment Then an inherited BG_DEV cannot switch the packaged backend into dev mode", () => {
    expect(windowsSource).toContain('start.EnvironmentVariables["BG_DEV"] = "0"');
    const service = body("private func startService()");
    expect(service).toContain('environment["BG_DEV"] = "0"');
  });

  test("Given the binary is missing When the macOS shell reports it Then the message names the path that was actually checked", () => {
    const service = body("private func startService()");
    const checked = /appendingPathComponent\("([^"]+)"\)/.exec(service)?.[1];
    const message = /NSLocalizedDescriptionKey: "([^"]+)"/.exec(service)?.[1];
    expect(checked).toBe("Contents/MacOS/burnguard-design");
    expect(message).toContain(checked ?? "<unreadable>");
  });

  test("Given the Windows shell blocks top-level navigation to /api/ and /runtime/ When the macOS navigation policy runs Then it blocks the same routes", () => {
    expect(windowsSource).toContain('StartsWith("/api/"');
    const policy = body("decidePolicyFor navigationAction: WKNavigationAction");
    expect(policy).toContain("/api/");
    expect(policy).toContain("/runtime/");
  });

  test("Given the Windows shell denies every WebView2 permission request When WKWebView asks for camera or microphone Then the macOS shell answers deny", () => {
    expect(windowsSource).toContain("PermissionRequested");
    expect(source).toContain("requestMediaCapturePermissionFor");
    expect(source).toMatch(/decisionHandler\(\.deny\)/);
  });
});
