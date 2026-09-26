import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";

function selectInline(style: string): Record<string, string> {
  const script = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html").match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const listeners = new Map<string, (event: unknown) => void>();
  const responses: { payload: { inline: Record<string, string> } | null }[] = [];
  const parent = { postMessage(message: { type: string; payload: { inline: Record<string, string> } | null }) { if (message.type === "response") responses.push(message); } };
  const node = { tagName: "P", textContent: "", closest: () => null, getAttribute: (name: string) => name === "style" ? style : null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) };
  runInNewContext(script, {
    window: { parent, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), getComputedStyle: () => ({ getPropertyValue: () => "" }) },
    document: { readyState: "loading", addEventListener() {}, documentElement: {}, elementFromPoint: () => node },
  });
  listeners.get("message")!({ source: parent, data: { __bgFrameBridge: true, type: "request", action: "hit-select", requestId: "r1", payload: { x: 1, y: 1 } } });
  return responses[0]!.payload!.inline;
}

test("Given a quoted semicolon and a function value When the bridge reads inline styles Then declarations split only at top-level semicolons (CSS-11)", () => {
  expect(selectInline("font-family:'A; B', serif; color: red")).toEqual({ "font-family": "'A; B', serif", color: "red" });
  expect(selectInline("background:url(data:image/png;base64,AAAA);color:#fff")).toEqual({ background: "url(data:image/png;base64,AAAA)", color: "#fff" });
  expect(selectInline("color:var(--x, #000);padding:4px;")).toEqual({ color: "var(--x, #000)", padding: "4px" });
});
