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
    const service = body("private func launchService(serviceURL: URL, loginEntries: [String]) throws");
    const stdout = service.slice(service.indexOf("\n        output.fileHandleForReading.readabilityHandler"), service.indexOf("errorOutput.fileHandleForReading.readabilityHandler"));
    const stderr = service.slice(service.indexOf("errorOutput.fileHandleForReading.readabilityHandler"), service.indexOf("process.terminationHandler"));
    for (const handler of [stdout, stderr]) expect(handler).toMatch(/\.isEmpty \{ handle\.readabilityHandler = nil/);
  });
});

describe("macOS service environment", () => {
  test("Given a launchd PATH When the backend environment is built Then login-shell, fixed and manager directories are merged once ahead of the inherited entries", () => {
    const service = body("private func launchService(serviceURL: URL, loginEntries: [String]) throws");
    const assigned = service.indexOf('environment["PATH"] = ');
    expect(assigned).toBeGreaterThan(service.indexOf("var environment = ProcessInfo.processInfo.environment"));
    expect(assigned).toBeLessThan(service.indexOf("process.environment = environment"));
    for (const directory of ['NSHomeDirectory() + "/.local/bin"', '"/opt/homebrew/bin"', '"/usr/local/bin"', 'NSHomeDirectory() + "/.bun/bin"']) expect(service).toContain(directory);
    expect(service).toContain("loginEntries + fixedPaths + searchPath + managerPathEntries()");
    expect(service).toMatch(/where !merged\.contains\(entry\)/);
    expect(service).toContain('environment["PATH"] = merged.joined(separator: ":")');
  });

  test("Given a Finder launch When the login shell is probed Then it runs once off the main thread with a 3 s bound on exit and output, and the value is never logged", () => {
    const probe = body("private func loginShellPathEntries()");
    expect(probe).toContain('"-i", "-l", "-c"');
    expect(probe).toContain('["-l", "-c"]');
    expect(probe).toContain("__BG_PATH__%s__BG_PATH__");
    expect(probe).toContain('environment["SHELL"]');
    expect(probe).toContain("getpwuid(getuid())");
    expect(probe).toContain('"/bin/zsh"');
    expect(probe).toContain("exited.wait(timeout: deadline)");
    expect(probe).toContain("drained.wait(timeout: deadline)");
    expect(probe).toContain("DispatchTime.now() + 3");
    expect(probe).toContain("readabilityHandler");
    expect(probe).not.toContain("readDataToEndOfFile");
    expect(probe).toContain("probe.terminate()");
    expect(probe).toContain("probe.standardInput = FileHandle.nullDevice");
    expect(probe).toContain("probe.standardError = FileHandle.nullDevice");
    expect(probe).not.toMatch(/print\(|NSLog|NSAlert/);
    const start = body("private func startService()");
    expect(start).toContain("DispatchQueue.global(");
    expect(start.match(/loginShellPathEntries\(\)/g)?.length).toBe(1);
    expect(start).toContain("launchService(serviceURL: serviceURL, loginEntries: loginEntries)");
  });

  test("Given Node version managers When the manager directories are collected Then only existing known directories and the newest nvm version are added", () => {
    const managers = body("private func managerPathEntries()");
    for (const directory of ['"/.volta/bin"', '"/.npm-global/bin"', '"/.local/share/fnm/aliases/default/bin"', '"/Library/Application Support/fnm/aliases/default/bin"', '"/.nvm/versions/node"']) expect(managers).toContain(directory);
    expect(managers).toContain("nvmVersionDirectory(home: home, versions: versions)");
    const nvm = body("private func nvmVersionDirectory(");
    expect(nvm).toContain('"/.nvm/alias/default"');
    expect(nvm).toContain("options: .numeric");
    expect(managers).toContain("candidates.filter { fileManager.fileExists(atPath: $0) }");
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
  test("Given a confirmed replacement When the download finishes or fails Then the original is swapped only on success and never deleted up front", () => {
    const destination = body("decideDestinationUsing response: URLResponse");
    const panel = destination.slice(destination.indexOf("panel.beginSheetModal"));
    expect(panel).toContain("guard result == .OK, let url = panel.url else { completionHandler(nil); return }");
    expect(panel).not.toContain("removeItem");
    expect(panel).toContain("self.pendingReplacements[ObjectIdentifier(download)] = (temporary: temporary, target: url)");
    expect(panel).toContain("completionHandler(temporary)");
    expect(body("func downloadDidFinish(")).toContain("try FileManager.default.replaceItemAt(replacement.target, withItemAt: replacement.temporary)");
    const failure = body("didFailWithError error: Error");
    const cleanup = failure.indexOf("removeItem(at: replacement.temporary)");
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(failure.indexOf("NSURLErrorCancelled"));
    // The user's confirmed file is only ever the destination of the atomic swap.
    for (const handler of [panel, body("func downloadDidFinish("), failure]) {
      expect(handler).not.toMatch(/(?:removeItem|trashItem)\(at: (?:url|replacement\.target)\b/);
    }
  });
});

const windowsSource = await readFile(path.join(import.meta.dir, "../desktop-windows/Program.cs"), "utf8");
const buildMacSource = await readFile(path.join(import.meta.dir, "../../scripts/build-mac.ts"), "utf8");
const osTestsWorkflow = await readFile(path.join(import.meta.dir, "../../.github/workflows/os-tests.yml"), "utf8");

/** Every `<name>["KEY"] = "VALUE"` assignment in `text`, keyed by KEY. */
function assignments(text: string, name: string): Record<string, string> {
  const pattern = new RegExp(`${name}\\["(\\w+)"\\] = "([^"]*)"`, "g");
  return Object.fromEntries([...text.matchAll(pattern)].map((match) => [match[1], match[2]]));
}

describe("macOS shell keeps the Windows shell's desktop contract", () => {
  test("Given a readiness line When the macOS shell consumes it Then the pid and the loopback origin are validated before the origin is trusted", () => {
    const windowsOrigin = /var expected = "([^"]+)" \+ port;/.exec(windowsSource)?.[1];
    expect(windowsOrigin).toBe("http://127.0.0.1:");
    expect(windowsSource).toContain('Convert.ToInt32(data["pid"]) != service.Id');
    const service = body("private func launchService(serviceURL: URL, loginEntries: [String]) throws");
    expect(/expectedOrigin = "([^"\\]+)\\\(port\)"/.exec(service)?.[1]).toBe(windowsOrigin);
    const consume = body("private func consumeServiceOutput(");
    const trusted = consume.indexOf("origin = url");
    for (const check of ['let pid = message["pid"] as? Int32', "pid == service.processIdentifier", "urlString == expectedOrigin"]) {
      expect(consume.indexOf(check)).toBeGreaterThan(-1);
      expect(consume.indexOf(check)).toBeLessThan(trusted);
    }
  });

  test("Given an inherited environment When the macOS shell builds the backend environment Then BG_DEV is forced to 0 and the desktop overrides match the Windows shell", () => {
    const windows = assignments(windowsSource, "start\\.EnvironmentVariables");
    const mac = assignments(body("private func launchService(serviceURL: URL, loginEntries: [String]) throws"), "environment");
    expect(windows.BG_DEV).toBe("0");
    for (const key of ["BG_DESKTOP", "BG_NO_OPEN", "BG_DEV"]) expect(mac[key]).toBe(windows[key]);
    expect(windowsSource).toContain('start.EnvironmentVariables.Remove("BG_SCAN_PORT")');
    expect(body("private func launchService(serviceURL: URL, loginEntries: [String]) throws")).toContain('environment.removeValue(forKey: "BG_SCAN_PORT")');
  });

  test("Given the backend binary is missing When the macOS shell reports it Then the message names the path that was actually checked", () => {
    const service = body("private func startService()");
    const checked = /appendingPathComponent\("([^"]+)"\)/.exec(service)?.[1];
    const message = /NSLocalizedDescriptionKey: "([^"]+)"/.exec(service)?.[1];
    expect(checked).toBe("Contents/MacOS/burnguard-design");
    expect(message?.startsWith(`${checked} `)).toBe(true);
  });

  test("Given a main-frame navigation to an app API or runtime route When the macOS policy runs Then it is cancelled with the Windows shell's prefixes, ignoring case", () => {
    const windowsRoute = /bool IsTopLevelAppRoute\(Uri uri\) => (.+);/.exec(windowsSource)?.[1] ?? "";
    const windowsPrefixes = [...windowsRoute.matchAll(/StartsWith\("([^"]+)", StringComparison\.OrdinalIgnoreCase\)/g)].map((match) => match[1]);
    expect(windowsPrefixes).toEqual(["/api/", "/runtime/"]);
    const route = body("private func isTopLevelAppRoute(_ url: URL) -> Bool");
    expect([...route.matchAll(/hasPrefix\("([^"]+)"\)/g)].map((match) => match[1])).toEqual(windowsPrefixes);
    expect(route).toContain(".lowercased()");
    const policy = body("decidePolicyFor navigationAction: WKNavigationAction");
    const guard = policy.indexOf("if navigationAction.targetFrame?.isMainFrame == true, isAppURL(url), !isTopLevelAppRoute(url) {\n            decisionHandler(.cancel)\n            return\n        }");
    expect(guard).toBeGreaterThan(policy.indexOf("navigationAction.shouldPerformDownload"));
    expect(guard).toBeLessThan(policy.indexOf("decisionHandler(isAppURL(url) ? .allow : .cancel)"));
  });

  test("Given WKWebView asks for camera or microphone When the UI delegate answers Then it denies, on an API the deployment target provides", () => {
    expect(windowsSource).toContain("PermissionRequested");
    expect(source).toMatch(/requestMediaCapturePermissionFor securityOrigin: WKSecurityOrigin,\s*initiatedByFrame frame: WKFrameInfo,\s*type: WKMediaCaptureType,\s*decisionHandler: @escaping \(WKPermissionDecision\) -> Void\s*\) \{/);
    expect(body("requestMediaCapturePermissionFor securityOrigin")).toMatch(/^\{\s*decisionHandler\(\.deny\)\s*\}$/);
    // WKUIDelegate media-capture decisions exist from macOS 12.
    expect(Number(/-target arm64-apple-macos(\d+)\./.exec(buildMacSource)?.[1])).toBeGreaterThanOrEqual(12);
  });

  test("Given a pull request When the macOS OS-tests job runs Then it typechecks main.swift with the build's Swift version and target", () => {
    const build = /swiftc\} -O (-swift-version \d+ -target \S+) -sdk/.exec(buildMacSource)?.[1];
    expect(build).toBe("-swift-version 5 -target arm64-apple-macos14.0");
    const step = /- name: Typecheck the native macOS shell\n\s+if: runner\.os == 'macOS'\n\s+run: swiftc -typecheck (.+) packages\/desktop-mac\/main\.swift\n/.exec(osTestsWorkflow)?.[1];
    expect(step).toBe(`${build} -sdk "$(xcrun --sdk macosx --show-sdk-path)"`);
  });
});

describe("macOS shutdown ordering", () => {
  test("Given a running backend When quit is requested Then termination waits for the backend's exit and a repeated quit is cancelled", () => {
    const terminate = body("func applicationShouldTerminate(");
    expect(terminate).toMatch(/guard service\?\.isRunning == true else \{ return \.terminateNow \}\s*if terminationReplyPending \{ return \.terminateCancel \}\s*terminationReplyPending = true\s*shutdown\(\)\s*return \.terminateLater/);
    const service = body("private func launchService(serviceURL: URL, loginEntries: [String]) throws");
    expect(service.slice(service.indexOf("process.terminationHandler"))).toContain("if self.closing { self.finishTermination(); return }");
    expect(body("private func finishTermination()")).toContain("if terminationReplyPending { NSApp.reply(toApplicationShouldTerminate: true) } else { NSApp.terminate(nil) }");
  });

  test("Given the backend announces its own shutdown When the event is consumed Then the shell waits for the backend instead of terminating", () => {
    const event = body('if message["event"] as? String == "shutdown"');
    expect(event).toContain("awaitServiceExit()");
    expect(event).not.toContain("NSApp.terminate");
  });

  test("Given shutdown When the backend outlives its drain deadline Then it is escalated to SIGKILL, never to the SIGTERM the backend handles itself", async () => {
    const shutdown = body("private func shutdown()");
    expect(shutdown).toContain("awaitServiceExit()");
    expect(shutdown).not.toMatch(/asyncAfter|NSApp\.terminate/);
    const wait = body("private func awaitServiceExit()");
    expect(wait).toContain("guard let service, service.isRunning else { DispatchQueue.main.async { [weak self] in self?.finishTermination() }; return }");
    expect(wait).toContain("if service.isRunning { kill(service.processIdentifier, SIGKILL) }");
    const turns = await readFile(path.join(import.meta.dir, "../backend/src/services/turns.ts"), "utf8");
    const drainMs = Number(/const SHUTDOWN_DRAIN_MS = ([\d_]+);/.exec(turns)?.[1]?.replaceAll("_", ""));
    expect(Number(/asyncAfter\(deadline: \.now\(\) \+ (\d+)\)/.exec(wait)?.[1]) * 1000).toBeGreaterThan(drainMs);
    expect(source).not.toMatch(/service\??\.terminate\(\)/);
  });
});
