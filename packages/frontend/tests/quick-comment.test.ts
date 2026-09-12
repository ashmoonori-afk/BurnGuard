import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { commentPointInFrame, frameCommentPointer, isCommentEditable, isQuickCommentShortcut, quickCommentPosition } from "../src/components/canvas/quick-comment";

function shortcut(overrides: Partial<KeyboardEvent> = {}) {
  return { key: " ", code: "Space", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...overrides };
}

const frame = {
  clientWidth: 800, clientHeight: 600,
  getBoundingClientRect: () => ({ left: 120, top: 70, right: 520, bottom: 370, width: 400, height: 300 }),
} as HTMLIFrameElement;

test("parent shortcut accepts only plain Control+Space, excluding repeats, composition and editable targets", () => {
  expect(isQuickCommentShortcut(shortcut(), false)).toBe(true);
  for (const overrides of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: false }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { key: "a", code: "KeyA" }]) {
    expect(isQuickCommentShortcut(shortcut(overrides), false)).toBe(false);
  }
  expect(isQuickCommentShortcut(shortcut(), true)).toBe(false);
  expect(isCommentEditable({ isContentEditable: true })).toBe(true);
  expect(isCommentEditable({ closest: selector => selector.includes("textarea") ? {} : null })).toBe(true);
  expect(isCommentEditable({ closest: () => null })).toBe(false);
  expect(isCommentEditable(null)).toBe(false);
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

function frameRuntime(html: string) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("bridge_script_missing");
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const messages: { event?: string; payload: unknown }[] = [];
  const frames: Array<() => void> = [];
  const parent = { postMessage: (data: { event?: string; payload: unknown }) => messages.push(data) };
  const document = { readyState: "loading", baseURI: "http://localhost/file.html", addEventListener() {} };
  runInNewContext(script, {
    URL,
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

function exerciseFrameShortcut(html: string) {
  const { listeners, messages } = frameRuntime(html);
  let prevented = 0;
  const press = (overrides = {}) => listeners.get("keydown")?.({ ...shortcut(), target: { closest: () => null }, preventDefault() { prevented++; }, ...overrides });
  press();
  expect(messages).toHaveLength(0);
  listeners.get("pointermove")?.({ clientX: 200, clientY: 150 });
  expect(messages.at(-1)).toMatchObject({ event: "comment-pointer", payload: { documentKey: "current", x: 200, y: 150 } });
  press();
  expect(messages.at(-1)).toMatchObject({ event: "comment-shortcut", payload: { documentKey: "current", x: 200, y: 150 } });
  expect(prevented).toBe(1);
  const count = messages.length;
  for (const overrides of [{ repeat: true }, { isComposing: true }, { target: { closest: () => ({}) } }, { ctrlKey: false }]) press(overrides);
  expect(messages).toHaveLength(count);
  expect(prevented).toBe(1);
  listeners.get("pointerout")?.({ relatedTarget: null });
  expect(messages.at(-1)).toMatchObject({ event: "comment-pointer", payload: { x: null, y: null } });
  press();
  expect(prevented).toBe(1);
}

test("opaque iframe tracks hover, forwards shortcut once, and ignores typing and pointer exit", () => {
  exerciseFrameShortcut(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html", { quickCommentKey: "current" }));
});

test("iframe Escape dismisses a popup without consuming authored Escape or text composition", () => {
  const { listeners, messages } = frameRuntime(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html", { quickCommentKey: "current" }));
  const escapeKey = { ...shortcut(), key: "Escape", code: "Escape", ctrlKey: false, target: { closest: () => null }, preventDefault() { throw new Error("authored_escape_consumed"); } };
  listeners.get("keydown")?.(escapeKey);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ event: "comment-dismiss", payload: { documentKey: "current" } });
  for (const override of [{ isComposing: true }, { repeat: true }, { target: { closest: () => ({}) } }]) listeners.get("keydown")?.({ ...escapeKey, ...override });
  expect(messages).toHaveLength(1);
});

test("non-canvas bridge consumers do not capture Control+Space", () => {
  const { listeners, messages } = frameRuntime(buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html"));
  listeners.get("pointermove")?.({ clientX: 200, clientY: 150 });
  listeners.get("keydown")?.({ ...shortcut(), preventDefault() { throw new Error("shortcut_captured"); } });
  expect(messages).toHaveLength(0);
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
  exerciseFrameShortcut(context.testBridge.buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html", { quickCommentKey: "current" }));
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
