import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright-core";
import { resolveRepoRoot } from "../lib/paths";
import { registerExportBrowser } from "./export-browser-registry";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../adapters/owned-process-tree";

export function chromiumNodeCommand(): { readonly node: string; readonly script: string; readonly cwd: string } | null {
  const root = resolveRepoRoot();
  const packagedScript = path.join(root, "chromium-node-bridge.mjs");
  const script = existsSync(packagedScript) ? packagedScript : fileURLToPath(new URL("./chromium-node-bridge.mjs", import.meta.url));
  const packagedNode = path.join(root, "node", process.platform === "win32" ? "node.exe" : "node");
  const node = existsSync(packagedNode) ? packagedNode : Bun.which("node");
  return node === null || !existsSync(script) ? null : { node, script, cwd: path.dirname(script) };
}

export async function launchChromiumViaNode(options: { readonly channel?: string }, signal: AbortSignal, command = chromiumNodeCommand()): Promise<Browser> {
  if (command === null) throw new Error("Node Chromium runtime is unavailable");
  signal.throwIfAborted();
  const child = Bun.spawn([command.node, command.script, JSON.stringify(options)], { ...ownedProcessSpawnOptions(), cwd: command.cwd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  let closing: Promise<void> | null = null;
  const closeChild = (): Promise<void> => closing ??= (async () => {
    signal.removeEventListener("abort", onAbort);
    child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forcedClose: Promise<void> | undefined;
    const deadline = new Promise<void>((resolve, reject) => { timer = setTimeout(() => {
      forcedClose = closeOwnedProcessTree(child.pid);
      void forcedClose.then(resolve, reject);
    }, 5000); });
    try { await Promise.race([child.exited, deadline]); }
    finally { clearTimeout(timer); await forcedClose; }
  })();
  const owner = registerExportBrowser(closeChild);
  const close = () => owner.close();
  const onAbort = () => { void close(); };
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(onAbort, 25000);
  try {
    const reader = child.stdout.getReader();
    let line = "";
    try {
      while (!line.includes("\n")) {
        const next = await reader.read();
        if (next.done) throw new Error("Chromium bridge closed before connecting");
        line += new TextDecoder().decode(next.value);
        if (line.length > 8192) throw new Error("Invalid Chromium bridge response");
      }
    } finally { reader.releaseLock(); }
    const message: unknown = JSON.parse(line.trim());
    if (typeof message !== "object" || message === null || !("endpoint" in message) || typeof message.endpoint !== "string") throw new Error("Invalid Chromium bridge response");
    const endpoint = new URL(message.endpoint);
    if (endpoint.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("Invalid Chromium bridge endpoint");
    signal.throwIfAborted();
    const browser = await connectNativeWebSocket(message.endpoint, signal);
    const browserClose = browser.close.bind(browser);
    browser.close = async (closeOptions) => { try { await browserClose(closeOptions); } finally { await close(); } };
    browser.once("disconnected", onAbort);
    if (signal.aborted) { await browser.close(); signal.throwIfAborted(); }
    return browser;
  } catch (error) { await close(); throw error; }
  finally { clearTimeout(timer); }
}

type NativeBrowser = Browser & { _connectToBrowserType: (type: typeof chromium, options: object, logger: undefined) => void; _shouldCloseConnectionOnClose: boolean; _didClose: () => void };
type NativeConnection = {
  onmessage: (message: unknown) => void;
  markAsRemote: () => void;
  dispatch: (message: unknown) => void;
  close: (reason?: string) => void;
  on: (event: "close", callback: () => void) => void;
  initializePlaywright: () => Promise<{ readonly _initializer: { readonly preLaunchedBrowser?: { readonly _object: NativeBrowser } } }>;
};

async function connectNativeWebSocket(endpoint: string, signal: AbortSignal): Promise<Browser> {
  // Playwright's Node ws transport stalls on Bun/Windows. Keep its protocol client and use Bun's native socket.
  // This is the only internal-API seam; the browser smoke test must pass when upgrading Playwright.
  const parent = (chromium as unknown as { readonly _connection: { readonly _platform: unknown; readonly constructor: new (platform: unknown) => NativeConnection } })._connection;
  const connection = new parent.constructor(parent._platform);
  connection.markAsRemote();
  const socket = new WebSocket(endpoint);
  let browser: NativeBrowser | undefined;
  const abort = () => { connection.close("Chromium connection aborted"); socket.close(); };
  const closed = () => { signal.removeEventListener("abort", abort); connection.close("Chromium connection closed"); browser?._didClose(); };
  socket.addEventListener("close", closed, { once: true });
  socket.addEventListener("error", abort, { once: true });
  signal.addEventListener("abort", abort, { once: true });
  connection.on("close", () => socket.close());
  socket.addEventListener("message", (event) => {
    try { connection.dispatch(JSON.parse(String(event.data))); }
    catch { abort(); }
  });
  connection.onmessage = (message) => socket.send(JSON.stringify(message));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { abort(); reject(new Error("Chromium connection timed out")); }, 10000);
      const fail = () => { clearTimeout(timer); reject(new Error("Chromium connection closed")); };
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener("open", () => { clearTimeout(timer); socket.removeEventListener("close", fail); resolve(); }, { once: true });
      if (signal.aborted) { abort(); fail(); }
    });
    const remote = await connection.initializePlaywright();
    browser = remote._initializer.preLaunchedBrowser?._object;
    if (browser === undefined) throw new Error("Chromium endpoint did not return a browser");
    browser._connectToBrowserType(chromium, {}, undefined);
    browser._shouldCloseConnectionOnClose = true;
    signal.throwIfAborted();
    return browser;
  } catch (error) { abort(); throw error; }
}
