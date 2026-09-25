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

describe("macOS service environment", () => {
  test("Given a launchd PATH When the backend environment is built Then missing user tool directories are added once ahead of the inherited entries", () => {
    const service = body("private func startService()");
    const assigned = service.indexOf('environment["PATH"] = ');
    expect(assigned).toBeGreaterThan(service.indexOf("var environment = ProcessInfo.processInfo.environment"));
    expect(assigned).toBeLessThan(service.indexOf("process.environment = environment"));
    for (const directory of ['NSHomeDirectory() + "/.local/bin"', '"/opt/homebrew/bin"', '"/usr/local/bin"', 'NSHomeDirectory() + "/.bun/bin"']) expect(service).toContain(directory);
    expect(service).toMatch(/\.filter \{ !searchPath\.contains\(\$0\) \}/);
    expect(service).toContain('environment["PATH"] = (userPaths + searchPath).joined(separator: ":")');
  });
});

describe("macOS external links", () => {
  test("Given a URL leaving the app When it is opened externally Then only NSWorkspace opens it, behind http(s), no-userinfo and non-app guards", () => {
    const open = body("private func openExternal(_ url: URL)");
    expect(open).toMatch(/guard url\.scheme == "https" \|\| url\.scheme == "http", url\.user == nil, url\.password == nil, !isAppURL\(url\) else \{ return \}/);
    expect(open).toContain("NSWorkspace.shared.open(url)");
    expect(source.match(/NSWorkspace/g)).toHaveLength(1);
  });

  test("Given window.open or a target=_blank request When WebKit asks for a new web view Then the URL goes to openExternal and no web view is created", () => {
    expect(source).toMatch(/createWebViewWith configuration: WKWebViewConfiguration,\s*for navigationAction: WKNavigationAction,\s*windowFeatures: WKWindowFeatures\s*\) -> WKWebView\? \{/);
    const create = body("createWebViewWith configuration: WKWebViewConfiguration");
    expect(create).toContain("if let url = navigationAction.request.url { openExternal(url) }");
    expect(create).toMatch(/return nil\s*\}$/);
  });

  test("Given a main-frame link activation When the navigation policy is decided Then it is opened externally and still decided by the app-origin rule", () => {
    const policy = body("decidePolicyFor navigationAction: WKNavigationAction");
    const tail = policy.slice(policy.indexOf("return", policy.indexOf("navigationAction.shouldPerformDownload")));
    const external = tail.indexOf("openExternal(url)");
    expect(tail).toMatch(/navigationAction\.navigationType == \.linkActivated, navigationAction\.sourceFrame\.isMainFrame,\s*navigationAction\.targetFrame\?\.isMainFrame != false/);
    expect(external).toBeGreaterThan(tail.indexOf(".linkActivated"));
    expect(external).toBeLessThan(tail.indexOf("decisionHandler(isAppURL(url) ? .allow : .cancel)"));
  });
});

describe("macOS main menu", () => {
  test("Given launch When the main menu is installed Then standard key equivalents reach the first responder, the window and the app", () => {
    expect(body("func applicationDidFinishLaunching(")).toMatch(/^\{\s*installMainMenu\(\)/);
    const menu = body("private func installMainMenu()");
    expect(menu).toContain("NSApp.mainMenu = ");
    expect(menu).not.toContain(".target");
    const bindings = { terminate: "q", undo: "z", redo: "Z", cut: "x", copy: "c", paste: "v", selectAll: "a", performMiniaturize: "m", performClose: "w" };
    for (const [action, key] of Object.entries(bindings)) {
      expect(menu).toMatch(new RegExp(`action: (?:#selector\\(\\w+\\.${action}\\(_:\\)\\)|Selector\\(\\("${action}:"\\)\\)), keyEquivalent: "${key}"`));
    }
  });
});

describe("macOS download destination", () => {
  test("Given the save panel returns .OK When the destination is handed to WebKit Then the confirmed existing file is removed first", () => {
    const destination = body("decideDestinationUsing response: URLResponse");
    const panel = destination.slice(destination.indexOf("panel.beginSheetModal"));
    expect(panel).toContain("guard result == .OK, let url = panel.url else { completionHandler(nil); return }");
    const removed = panel.indexOf("try? FileManager.default.removeItem(at: url)");
    expect(removed).toBeGreaterThan(panel.indexOf("guard result == .OK"));
    expect(removed).toBeLessThan(panel.indexOf("completionHandler(url)"));
  });
});
