import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildSandboxedArtifactSrcDoc, readFrameCommentPositions } from "../src/components/canvas/frame-bridge";
import { commentPointInFrame, frameCommentPointer, isCommentEditable, isQuickCommentShortcut, quickCommentPosition } from "../src/components/canvas/quick-comment";

function shortcut(overrides: Partial<KeyboardEvent> = {}) {
  return { key: " ", code: "Space", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...overrides };
}

const frame = {
  clientWidth: 800, clientHeight: 600,
  getBoundingClientRect: () => ({ left: 120, top: 70, right: 520, bottom: 370, width: 400, height: 300 }),
} as HTMLIFrameElement;

const platforms = [
  { platform: "MacIntel", altKey: true },
  { platform: "MacPPC", altKey: true },
  { platform: "Win32", altKey: false },
  { platform: "Linux x86_64", altKey: false },
];

for (const { platform, altKey } of platforms) {
  test(`${platform} parent accepts its chord and rejects other modifiers, repeats, IME and typing`, () => {
    expect(isQuickCommentShortcut(shortcut({ altKey }), false, platform)).toBe(true);
    expect(isQuickCommentShortcut(shortcut({ altKey, key: "\u00a0" }), false, platform)).toBe(true);
    expect(isQuickCommentShortcut(shortcut({ altKey, code: "" }), false, platform)).toBe(true);
    for (const overrides of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: false }, { metaKey: true }, { altKey: !altKey }, { shiftKey: true }, { altKey: false, shiftKey: true }, { key: "a", code: "KeyA" }]) {
      expect(isQuickCommentShortcut(shortcut({ altKey, ...overrides }), false, platform)).toBe(false);
    }
    expect(isQuickCommentShortcut(shortcut({ altKey }), true, platform)).toBe(false);
  });
}

test("editable targets are excluded", () => {
  expect(isCommentEditable({ isContentEditable: true })).toBe(true);
  expect(isCommentEditable({ closest: selector => selector.includes("textarea") ? {} : null })).toBe(true);
  expect(isCommentEditable({ closest: () => null })).toBe(false);
  expect(isCommentEditable(null)).toBe(false);
});

test("Given opaque frame position updates When the document or coordinates are invalid Then pins reject the update", () => {
  const position = { id: "c1", x: 75, y: -12, visible: false };
  expect(readFrameCommentPositions({ documentKey: "current", positions: [position] }, "current")).toEqual([position]);
  for (const payload of [null, {}, { documentKey: "old", positions: [position] }, { documentKey: "current", positions: {} },
    { documentKey: "current", positions: [{ ...position, x: NaN }] }, { documentKey: "current", positions: [{ ...position, visible: "yes" }] }]) {
    expect(readFrameCommentPositions(payload, "current")).toBeNull();
  }
});

test("Given a saved node-local pin When its document scrolls or its ancestor clips Then bridge coordinates follow the content", () => {
  const html = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/index.html", { quickCommentKey: "current" });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("bridge_script_missing");
  const listeners = new Map<string, (event: unknown) => void>();
  const frames: Array<() => void> = [];
  const messages: Array<{ payload: unknown }> = [];
  const parent = { postMessage: (data: { payload: unknown }) => messages.push(data) };
  let top = 250, height = 100, clipped = false;
  const root = { scrollWidth: 800, scrollHeight: 2000, parentElement: null, getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 2000 }) };
  const scroller = { parentElement: root, getBoundingClientRect: () => ({ left: 0, top: 100, right: 800, bottom: 160 }) };
  const node = { nodeType: 1, id: "hero", tagName: "IMG", parentElement: scroller, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 200, top, width: 200, height }) };
  const document = { readyState: "loading", baseURI: "http://localhost/index.html", documentElement: root, body: root,
    addEventListener() {}, elementFromPoint: () => node, querySelector: (selector: string) => selector === "#hero" ? node : null,
    querySelectorAll: (selector: string) => selector === "#hero" ? [node] : [] };
  const frameWindow = { parent, innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0,
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) };
  runInNewContext(script, { URL, document, window: frameWindow, navigator: { platform: "Win32" },
    getComputedStyle: (element: unknown) => ({ overflowX: "visible", overflowY: clipped && element === scroller ? "auto" : "visible" }),
    requestAnimationFrame: (callback: () => void) => frames.push(callback) });
  const request = (action: string, payload: unknown, source: unknown = parent) => listeners.get("message")?.({ source,
    data: { __bgFrameBridge: true, type: "request", requestId: "test", action, payload } });
  request("hit-comment", { x: 250, y: 300 }, {});
  expect(messages).toHaveLength(0);
  request("hit-comment", { x: 250, y: 300 });
  expect(messages.at(-1)?.payload).toEqual({ selector: "#hero", slideIndex: null, x_pct: 31.25, y_pct: 15, anchor: { version: 1, x_pct: 25, y_pct: 50 } });
  const comment = { id: "c1", node_selector: "#hero", x_pct: 31.25, y_pct: 15, anchor: { version: 1, x_pct: 25, y_pct: 50 } };
  request("watch-comments", { comments: [comment] });
  expect(messages.at(-1)?.payload).toEqual({ documentKey: "current", positions: [{ id: "c1", x: 250, y: 300, visible: true }] });
  const changed = (event: string) => { listeners.get(event)?.({}); frames.shift()?.(); return messages.at(-1)?.payload; };
  frameWindow.scrollY = 120; top -= 120;
  expect(changed("scroll")).toMatchObject({ positions: [{ x: 250, y: 180, visible: true }] });
  clipped = true;
  expect(changed("scroll")).toMatchObject({ positions: [{ y: 180, visible: false }] });
  top = 60;
  expect(changed("scroll")).toMatchObject({ positions: [{ y: 110, visible: true }] });
  clipped = false; height = 200;
  expect(changed("resize")).toMatchObject({ positions: [{ x: 250, y: 160, visible: true }] });
  request("watch-comments", { comments: [{ ...comment, anchor: null }] });
  expect(messages.at(-1)?.payload).toMatchObject({ positions: [{ x: 300, y: 160, visible: true }] });
});

test("hover coordinates round-trip across zoom and pan; stale and out-of-frame events are rejected", () => {
  const point = frameCommentPointer({ documentKey: "current", x: 200, y: 150 }, "current", frame);
  expect(point).toEqual({ x: 220, y: 145 });
  if (!point) throw new Error("expected_canvas_point");
  expect(commentPointInFrame(frame, point)).toEqual({ x: 200, y: 150 });
  expect(commentPointInFrame(frame, { x: 100, y: 145 })).toBeNull();
  expect(commentPointInFrame(frame, { x: 520, y: 145 })).toBeNull();
  for (const payload of [null, {}, { documentKey: "old", x: 200, y: 150 }, { documentKey: "current", x: null, y: null }, { documentKey: "current", x: NaN, y: 1 }, { documentKey: "current", x: -1, y: 1 }, { documentKey: "current", x: 800, y: 1 }, { documentKey: "current", x: 1, y: 600 }]) {
    expect(frameCommentPointer(payload, "current", frame)).toBeNull();
  }
});

test("popup remains inside viewport at screen edges and after narrow-viewport resizing", () => {
  expect(quickCommentPosition({ x: 100, y: 80 }, { width: 320, height: 240 }, { width: 1200, height: 800 })).toEqual({ left: 112, top: 92 });
  expect(quickCommentPosition({ x: 1190, y: 790 }, { width: 320, height: 240 }, { width: 1200, height: 800 })).toEqual({ left: 868, top: 548 });
  expect(quickCommentPosition({ x: 350, y: 600 }, { width: 296, height: 240 }, { width: 320, height: 640 })).toEqual({ left: 12, top: 388 });
});

function frameRuntime(html: string, platform = "Win32") {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("bridge_script_missing");
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const messages: { event?: string; payload: unknown }[] = [];
  const frames: Array<() => void> = [];
  const parent = { postMessage: (data: { event?: string; payload: unknown }) => messages.push(data) };
  const document = { readyState: "loading", baseURI: "http://localhost/file.html", addEventListener() {} };
  runInNewContext(script, {
    URL,
    navigator: { platform },
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    window: { parent, addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => listeners.set(name, listener) },
    document,
  });
  return { listeners, messages, document, frames };
}

test("loaded canvas documents identify themselves instead of relying on an unversioned iframe load", () => {
  const runtime = frameRuntime(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html", { quickCommentKey: "current" }));
  expect(runtime.messages).toHaveLength(0);
  runtime.document.readyState = "complete";
  runtime.listeners.get("load")?.({});
  expect(runtime.messages).toHaveLength(0);
  runtime.frames[0]?.();
  expect(runtime.messages).toEqual([{
    __bgFrameBridge: true, type: "event", event: "document-loaded", payload: { documentKey: "current" },
  }]);
});

test("local navigation is intercepted before document loading finishes", () => {
  const runtime = frameRuntime(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html"));
  let prevented = false;
  const link = { hasAttribute: () => false, getAttribute: (name: string) => name === "href" ? "next.html" : null };
  runtime.listeners.get("click")?.({ button: 0, target: { closest: () => link }, preventDefault() { prevented = true; } });
  expect(prevented).toBe(true);
  expect(runtime.messages).toEqual([{
    __bgFrameBridge: true, type: "event", event: "navigate", payload: { href: "http://localhost/next.html" },
  }]);
});

function exerciseFrameShortcut(html: string, { platform, altKey }: { platform: string; altKey: boolean }) {
  const { listeners, messages } = frameRuntime(html, platform);
  let prevented = 0;
  const press = (overrides = {}) => listeners.get("keydown")?.({ ...shortcut({ altKey }), target: { closest: () => null }, preventDefault() { prevented++; }, ...overrides });
  press();
  expect(messages).toHaveLength(0);
  listeners.get("pointermove")?.({ clientX: 200, clientY: 150 });
  expect(messages.at(-1)).toMatchObject({ event: "comment-pointer", payload: { documentKey: "current", x: 200, y: 150 } });
  press();
  expect(messages.at(-1)).toMatchObject({ event: "comment-shortcut", payload: { documentKey: "current", x: 200, y: 150 } });
  expect(prevented).toBe(1);
  const count = messages.length;
  for (const overrides of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { target: { closest: () => ({}) } }, { ctrlKey: false }, { altKey: !altKey }, { metaKey: true }, { shiftKey: true }, { altKey: false, shiftKey: true }, { key: "a", code: "KeyA" }]) press(overrides);
  expect(messages).toHaveLength(count);
  expect(prevented).toBe(1);
  listeners.get("pointerout")?.({ relatedTarget: null });
  expect(messages.at(-1)).toMatchObject({ event: "comment-pointer", payload: { x: null, y: null } });
  press();
  expect(prevented).toBe(1);
}

for (const platform of platforms) {
  test(`${platform.platform} opaque iframe forwards only its chord once and ignores typing and pointer exit`, () => {
    exerciseFrameShortcut(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html", { quickCommentKey: "current" }), platform);
  });
}

test("iframe Escape dismisses a popup without consuming authored Escape or text composition", () => {
  const { listeners, messages } = frameRuntime(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html", { quickCommentKey: "current" }));
  const escapeKey = { ...shortcut(), key: "Escape", code: "Escape", ctrlKey: false, target: { closest: () => null }, preventDefault() { throw new Error("authored_escape_consumed"); } };
  listeners.get("keydown")?.(escapeKey);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ event: "comment-dismiss", payload: { documentKey: "current" } });
  for (const override of [{ isComposing: true }, { repeat: true }, { target: { closest: () => ({}) } }]) listeners.get("keydown")?.({ ...escapeKey, ...override });
  expect(messages).toHaveLength(1);
});

test("non-canvas bridge consumers do not capture either platform chord", () => {
  for (const { platform, altKey } of platforms) {
    const { listeners, messages } = frameRuntime(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html"), platform);
    listeners.get("pointermove")?.({ clientX: 200, clientY: 150 });
    listeners.get("keydown")?.({ ...shortcut({ altKey }), preventDefault() { throw new Error("shortcut_captured"); } });
    expect(messages).toHaveLength(0);
  }
});

test("production-minified bridge preserves keyboard runtime and source-checks iframe events and hit responses", async () => {
  const compiler = Bun.spawn([
    process.execPath, "build", `${import.meta.dir}/fixtures/quick-comment-browser.ts`,
    "--target=browser", "--format=iife", "--minify",
  ], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, script, errors] = await Promise.all([
    compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`Bridge bundle failed (${exitCode}): ${errors}`);
  const listeners = new Map<string, (event: unknown) => void>();
  const timers = new Map<number, () => void>();
  const context = {
    URL, crypto,
    window: {
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
      setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; },
      clearTimeout: (id: number) => { timers.delete(id); },
    },
    testBridge: null as unknown as typeof import("../src/components/canvas/frame-bridge"),
  };
  runInNewContext(script, context);
  for (const platform of platforms) {
    exerciseFrameShortcut(context.testBridge.buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html", { quickCommentKey: "current" }), platform);
  }
  const requests: { requestId: string; payload: unknown }[] = [];
  const source = { postMessage: (request: { requestId: string; payload: unknown }) => requests.push(request) };
  const iframe = { contentWindow: source } as unknown as HTMLIFrameElement;
  const received: unknown[] = [];
  const unsubscribe = context.testBridge.subscribeFrameEvent(iframe, "comment-shortcut", payload => received.push(payload));
  const payload = { documentKey: "current", x: 200, y: 150 };
  const data = { __bgFrameBridge: true, type: "event", event: "comment-shortcut", payload };
  listeners.get("message")?.({ source: {}, data });
  expect(received).toHaveLength(0);
  listeners.get("message")?.({ source, data });
  expect(received).toEqual([payload]);
  unsubscribe();
  listeners.get("message")?.({ source, data });
  expect(received).toHaveLength(1);

  const hit = context.testBridge.requestFrameCommentAtPoint(iframe, 200, 150);
  expect(requests[0]?.payload).toEqual({ x: 200, y: 150 });
  const response = { __bgFrameBridge: true, type: "response", requestId: requests[0]?.requestId, payload: { selector: "#hero", slideIndex: 2 } };
  listeners.get("message")?.({ source: {}, data: response });
  expect(timers.size).toBe(1);
  listeners.get("message")?.({ source, data: response });
  expect(timers.size).toBe(0);
  expect(await hit).toEqual({ selector: "#hero", slideIndex: 2 });
});
