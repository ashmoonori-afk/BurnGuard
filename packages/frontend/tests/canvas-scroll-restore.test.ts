import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";

function bridge() {
  const script = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html").match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const listeners = new Map<string, (event: unknown) => void>();
  const responses: { requestId: string; payload: unknown }[] = [];
  const scrolled: [number, number][] = [];
  const parent = { postMessage(message: { type: string; requestId: string; payload: unknown }) { if (message.type === "response") responses.push(message); } };
  runInNewContext(script, {
    window: { parent, scrollX: 12, scrollY: 340, scrollTo: (x: number, y: number) => scrolled.push([x, y]), addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) },
    document: { readyState: "loading", addEventListener() {}, documentElement: {} },
  });
  let sequence = 0;
  const request = (action: string, payload: Record<string, unknown> = {}) => { const requestId = `${action}:${sequence++}`; listeners.get("message")!({ source: parent, data: { __bgFrameBridge: true, type: "request", action, requestId, payload } }); return responses.find((response) => response.requestId === requestId)?.payload; };
  return { request, scrolled };
}

test("Given a scrolled document When the parent asks for and later restores the scroll position Then the bridge reports window scroll offsets and scrolls to the restored point (UXW-15)", () => {
  const { request, scrolled } = bridge();
  expect(request("scroll-position")).toEqual({ x: 12, y: 340 });
  expect(request("set-scroll-position", { x: 12, y: 340 })).toBe(true);
  expect(request("set-scroll-position", { x: "12", y: Number.NaN })).toBe(false);
  expect(scrolled).toEqual([[12, 340]]);
});

test("Given the canvas source When scanned Then the outgoing frame's scroll is captured before a version swap and restored after the document loads, like slides", async () => {
  const source = await Bun.file(new URL("../src/components/canvas/Canvas.tsx", import.meta.url)).text();
  expect(source).toContain("requestFrameScrollPosition(");
  expect(source).toContain("requestFrameSetScrollPosition(");
  expect(source.indexOf("requestFrameScrollPosition(")).toBeLessThan(source.indexOf("authorizedFetch(src"));
});
