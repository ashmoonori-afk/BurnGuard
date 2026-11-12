import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MODES } from "../src/components/canvas/CanvasTopBar";
import { buildSandboxedArtifactSrcDoc, FRAME_SNAP_SIBLING_LIMIT, parseFrameSnapRects, requestFrameSnapRects, type FrameSnapRects } from "../src/components/canvas/frame-bridge";
import ModePanel from "../src/components/modes/ModePanel";
import type { CanvasMode } from "../src/components/modes/types";

const panelProps = {
  projectId: "project",
  comments: [],
  activeRelPath: "index.html",
  activeSlideIdx: null,
  focusedCommentId: null,
  onFocusComment() {},
  onUpdateCommentBody() {},
  onToggleCommentResolved() {},
  editTarget: null,
  editSaving: false,
  onSaveEdit() {},
  onClearEdit() {},
  tweaksTarget: null,
  tweaksSaving: false,
  onApplyTweak() {},
  onResetTweaks() {},
  onClearTweaks() {},
  tweakReview: null,
  drawTool: "pen" as const,
  drawColor: "#EF4444",
  drawStrokeWidth: 4,
  drawHasShapes: false,
  drawCanRedo: false,
  onChangeDrawTool() {},
  onChangeDrawColor() {},
  onChangeDrawWidth() {},
  onUndoDraw() {},
  onRedoDraw() {},
  onClearDraw() {},
  quality: { state: { kind: "idle" as const }, pendingFindingId: null, focusedFindingId: null, revealResult: null, onRetry() {}, onOpenFile() {}, onReveal() {}, onApplySafeFix() {}, onAutoFix() {}, onRequestFix() {}, autoFixPending: false, autoFixDisabled: false },
  uxReview: { projectId: "project", relPath: "index.html", digest: "a".repeat(64), revision: 1, disabled: false, async onRequestAI() {} },
};

function panelMarkup(mode: CanvasMode): string {
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ModePanel, { mode, ...panelProps })));
}

describe("canvas mode table", () => {
  test("Given the toolbar modes When listed Then every id and hint is unique and the select alias is gone", () => {
    const ids = MODES.map((mode) => mode.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("select");
    const hints = MODES.map((mode) => mode.hint);
    expect(new Set(hints).size).toBe(hints.length);
  });

  test("Given each toolbar mode When its panel renders Then no two modes share the same panel markup", () => {
    const rendered = MODES.map((mode) => panelMarkup(mode.id));
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});

/** The 2x2 part of a DOMMatrix, enough for the bridge to read rotation and scale. */
class Matrix {
  a = 1; b = 0; c = 0; d = 1;
  constructor(init?: string) {
    const values = init?.match(/^matrix\(([^)]+)\)$/)?.[1]?.split(",").map(Number);
    if (values) [this.a, this.b, this.c, this.d] = values as [number, number, number, number];
  }
  rotate(degrees: number): Matrix {
    const radians = degrees * Math.PI / 180;
    return this.multiply(Object.assign(new Matrix(), { a: Math.cos(radians), b: Math.sin(radians), c: -Math.sin(radians), d: Math.cos(radians) }));
  }
  multiply(other: Matrix): Matrix {
    return Object.assign(new Matrix(), { a: this.a * other.a + this.c * other.b, b: this.b * other.a + this.d * other.b, c: this.a * other.c + this.c * other.d, d: this.b * other.c + this.d * other.d });
  }
}

interface FakeNode {
  tagName: string; textContent: string; style: Record<string, string>; attrs: Record<string, string>;
  offsetWidth: number; offsetHeight: number; scrollLeft: number; scrollTop: number;
  parentElement: FakeNode | null; children: FakeNode[];
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  closest(selector: string): FakeNode | null;
}

function fake(box: [number, number, number, number], init: { id?: string; tag?: string; text?: string; style?: Record<string, string>; attrs?: Record<string, string>; offset?: [number, number]; children?: FakeNode[] } = {}): FakeNode {
  const [left, top, width, height] = box;
  const node: FakeNode = {
    tagName: init.tag ?? "DIV", textContent: init.text ?? "", style: init.style ?? {}, attrs: { ...(init.id ? { "data-bg-node-id": init.id } : {}), ...init.attrs },
    offsetWidth: init.offset?.[0] ?? width, offsetHeight: init.offset?.[1] ?? height, scrollLeft: 0, scrollTop: 0, parentElement: null, children: init.children ?? [],
    getAttribute: (name) => node.attrs[name] ?? null,
    getBoundingClientRect: () => ({ left, top, width, height }),
    closest: (selector) => { for (let current: FakeNode | null = node; current; current = current.parentElement) if (selector.slice(1, -1) in current.attrs) return current; return null; },
  };
  for (const child of node.children) child.parentElement = node;
  return node;
}

function allNodes(root: FakeNode): FakeNode[] { return [root, ...root.children.flatMap(allNodes)]; }

function bridge(root: FakeNode, pointNode: FakeNode | null = null) {
  const script = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html").match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const listeners = new Map<string, (event: unknown) => void>();
  const responses: unknown[] = [];
  const parent = { postMessage(message: { type: string; payload: unknown }) { if (message.type === "response") responses.push(message.payload); } };
  const computed = (node: FakeNode) => ({ ...node.style, getPropertyValue: (name: string) => node.style[name] ?? "" });
  const nodes = allNodes(root);
  runInNewContext(script, {
    DOMMatrix: Matrix, getComputedStyle: computed,
    window: { parent, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), getComputedStyle: computed },
    document: { readyState: "loading", addEventListener() {}, documentElement: {}, elementFromPoint: () => pointNode,
      querySelector: (selector: string) => { const id = selector.match(/^\[data-bg-node-id="(.*)"\]$/)?.[1]; return nodes.find((node) => node.attrs["data-bg-node-id"] === id) ?? null; } },
  });
  return (action: string, payload: Record<string, unknown>): unknown => {
    listeners.get("message")!({ source: parent, data: { __bgFrameBridge: true, type: "request", action, requestId: "r", payload } });
    // The real answer crosses postMessage, so only its structured-clone shape matters.
    return JSON.parse(JSON.stringify(responses.at(-1) ?? null));
  };
}

const snapRects = (root: FakeNode, bgId: string) => bridge(root)("snap-rects", { bgId }) as FrameSnapRects | null;
const GRID = { display: "grid", "grid-template-columns": "100px 100px 100px", "column-gap": "16px", "grid-template-rows": "40px", "row-gap": "normal" };

describe("snap rects bridge", () => {
  test("Given a padded flow parent When snap rects are read Then the content box, the element and its visible neighbours come back nearest first", () => {
    const parent = fake([100, 50, 400, 300], { style: { display: "block", paddingLeft: "10px", paddingTop: "10px", paddingRight: "10px", paddingBottom: "10px", borderLeftWidth: "2px", borderTopWidth: "2px", borderRightWidth: "2px", borderBottomWidth: "2px" }, children: [
      fake([112, 62, 100, 40], { id: "a" }),
      fake([230, 62, 100, 40], { id: "b", text: "  Card \n 2 " }),
      fake([112, 200, 100, 40], { id: "hidden", style: { visibility: "hidden" } }),
      fake([350, 62, 50, 40]),
      fake([112, 62, 0, 0], { id: "empty" }),
      fake([112, 110, 100, 40], { id: "e", tag: "SECTION" }),
    ] });
    expect(snapRects(parent, "a")).toEqual({
      self: { left: 112, top: 62, width: 100, height: 40, rotation: 0, boxWidth: 100, boxHeight: 40, scaleX: 1, scaleY: 1, basis: [1, 0, 0, 1] },
      parent: { rect: { left: 100, top: 50, width: 400, height: 300 }, content: { left: 112, top: 62, width: 376, height: 276 }, display: "block", columnLines: [], rowLines: [] },
      artboard: null,
      siblings: [{ bgId: "e", rect: { left: 112, top: 110, width: 100, height: 40 }, label: "section" }, { bgId: "b", rect: { left: 230, top: 62, width: 100, height: 40 }, label: "Card 2" }],
    });
  });

  test("Given a grid parent with 3 columns and a 16 px gap When snap rects are read Then 4 column lines carry both edges of each gap", () => {
    const parent = fake([20, 10, 332, 40], { style: GRID, children: [fake([20, 10, 100, 40], { id: "a" })] });
    const rects = snapRects(parent, "a")!;
    expect(rects.parent!.columnLines).toEqual([{ start: 20, end: 20 }, { start: 120, end: 136 }, { start: 236, end: 252 }, { start: 352, end: 352 }]);
    expect(rects.parent!.rowLines).toEqual([{ start: 10, end: 10 }, { start: 50, end: 50 }]);
    const named = fake([20, 10, 216, 40], { style: { ...GRID, "grid-template-columns": "[full-start] 100px [mid a] 100px [full-end]" }, children: [fake([20, 10, 100, 40], { id: "a" })] });
    expect(snapRects(named, "a")!.parent!.columnLines).toHaveLength(3);
    const scrolled = fake([20, 10, 200, 40], { style: GRID, children: [fake([20, 10, 100, 40], { id: "a" })] });
    scrolled.scrollLeft = 30;
    expect(snapRects(scrolled, "a")!.parent!.columnLines[0]).toEqual({ start: -10, end: -10 });
  });

  test("Given tracks that are not plain pixels, a rotated grid or a flow parent When snap rects are read Then no grid lines are offered", () => {
    const child = () => [fake([20, 10, 100, 40], { id: "a" })];
    expect(snapRects(fake([20, 10, 332, 40], { style: { ...GRID, "grid-template-columns": "subgrid" }, children: child() }), "a")!.parent!.columnLines).toEqual([]);
    expect(snapRects(fake([20, 10, 332, 40], { style: { ...GRID, rotate: "30deg" }, children: child() }), "a")!.parent!.columnLines).toEqual([]);
    expect(snapRects(fake([20, 10, 332, 40], { style: { ...GRID, display: "block" }, children: child() }), "a")!.parent!.columnLines).toEqual([]);
    expect(snapRects(fake([20, 10, 332, 40], { style: { ...GRID, "writing-mode": "vertical-rl" }, children: child() }), "a")!.parent!.columnLines).toEqual([]);
  });

  test("Given a grid inside a slide scaled to 50% When snap rects are read Then lines are in client pixels and the slide is the artboard", () => {
    const grid = fake([10, 10, 166, 20], { style: GRID, offset: [332, 40], children: [fake([10, 10, 50, 20], { id: "a", offset: [100, 40] })] });
    const slide = fake([0, 0, 640, 360], { attrs: { "data-slide": "" }, style: { transform: "matrix(0.5, 0, 0, 0.5, 0, 0)" }, offset: [1280, 720], children: [grid] });
    const rects = snapRects(slide, "a")!;
    expect(rects.parent!.columnLines).toEqual([{ start: 10, end: 10 }, { start: 60, end: 68 }, { start: 118, end: 126 }, { start: 176, end: 176 }]);
    expect(rects.artboard).toEqual({ left: 0, top: 0, width: 640, height: 360 });
    expect(rects.self).toMatchObject({ boxWidth: 50, scaleX: 0.5, basis: [0.5, 0, 0, 0.5] });
  });

  test("Given free space, a percentage gap or a right-to-left grid When snap rects are read Then lines follow where the browser places the tracks", () => {
    const lines = (width: number, style: Record<string, string>) => snapRects(fake([20, 10, width, 40], { style: { ...GRID, ...style }, children: [fake([20, 10, 100, 40], { id: "a" })] }), "a")!.parent!.columnLines;
    expect(lines(400, { "justify-content": "center" })[0]).toEqual({ start: 54, end: 54 });
    expect(lines(400, { "justify-content": "end" })[3]).toEqual({ start: 420, end: 420 });
    expect(lines(400, { "justify-content": "space-between" })[1]).toEqual({ start: 120, end: 170 });
    expect(lines(400, { "justify-content": "space-evenly" })[0]).toEqual({ start: 37, end: 37 });
    expect(lines(400, { "justify-content": "space-around", "column-gap": "0px", "grid-template-columns": "100px 100px" })).toEqual([{ start: 70, end: 70 }, { start: 170, end: 270 }, { start: 370, end: 370 }]);
    expect(lines(400, { "column-gap": "10%", "grid-template-columns": "100px 100px" })[1]).toEqual({ start: 120, end: 160 });
    expect(lines(316, { direction: "rtl", "grid-template-columns": "100px 200px" })).toEqual([{ start: 20, end: 20 }, { start: 220, end: 236 }, { start: 336, end: 336 }]);
  });

  test("Given more than 80 siblings When snap rects are read Then only the 80 nearest are returned", () => {
    const row = Array.from({ length: 100 }, (_, index) => fake([110 * (99 - index) + 200, 0, 100, 40], { id: `s${99 - index}` }));
    const parent = fake([0, 0, 12000, 40], { children: [...row, fake([90, 0, 100, 40], { id: "a" })] });
    const siblings = snapRects(parent, "a")!.siblings;
    expect(siblings).toHaveLength(FRAME_SNAP_SIBLING_LIMIT);
    expect([siblings[0]!.bgId, siblings[79]!.bgId]).toEqual(["s0", "s79"]);
  });

  test("Given an unknown node id When snap rects are requested Then the answer is null, and a root element has no parent or neighbours", () => {
    const parent = fake([0, 0, 100, 40], { children: [fake([0, 0, 50, 40], { id: "a" })] });
    expect(snapRects(parent, "missing")).toBeNull();
    expect(snapRects(fake([0, 0, 50, 40], { id: "root" }), "root")).toMatchObject({ parent: null, artboard: null, siblings: [] });
  });

  test("Given a selected element When the bridge reads its styles Then position, grid and picture-fit properties are included", () => {
    const node = fake([0, 0, 50, 40], { id: "a", style: { translate: "4px 8px", "grid-column": "span 2", "object-fit": "cover" } });
    const hit = bridge(node, node)("hit-bg", { x: 1, y: 1 }) as { computed: Record<string, string> };
    expect(hit.computed).toMatchObject({ translate: "4px 8px", "grid-column": "span 2", "object-fit": "cover" });
    for (const key of ["position", "grid-template-columns", "grid-auto-rows", "gap", "grid-row", "min-width", "object-position"]) expect(Object.keys(hit.computed)).toContain(key);
  });
});

describe("snap rects parsing", () => {
  const box = { left: 1, top: 2, width: 3, height: 4 };
  const valid = { self: { ...box, rotation: 0, boxWidth: 3, boxHeight: 4, scaleX: 1, scaleY: 1, basis: [1, 0, 0, 1] }, parent: { rect: box, content: box, display: "grid", columnLines: [{ start: 1, end: 2 }], rowLines: [] }, artboard: box, siblings: [{ bgId: "b", rect: box, label: "Card" }] };

  test("Given a well-formed answer When parsed Then it passes through, and a missing parent or artboard stays null", () => {
    expect(parseFrameSnapRects(valid)).toEqual(valid);
    expect(parseFrameSnapRects({ ...valid, parent: null, artboard: null })).toMatchObject({ parent: null, artboard: null });
    expect(parseFrameSnapRects({ ...valid, extra: "ignored" })).toEqual(valid);
  });

  test("Given a number that is missing, not finite or not a number When parsed Then the whole answer is dropped", () => {
    for (const broken of [
      null, "text", [],
      { ...valid, self: { ...box, left: "1" } },
      { ...valid, self: { ...valid.self, rotation: Number.NaN } },
      { ...valid, self: { ...valid.self, basis: [1, 0, 0] } },
      { ...valid, self: { ...valid.self, basis: [1, 0, 0, Number.NaN] } },
      { ...valid, self: { ...valid.self, basis: "1 0 0 1" } },
      { ...valid, parent: { ...valid.parent, content: { ...box, width: Number.POSITIVE_INFINITY } } },
      { ...valid, parent: { ...valid.parent, columnLines: [{ start: 1 }] } },
      { ...valid, parent: { ...valid.parent, columnLines: Array.from({ length: 202 }, () => ({ start: 0, end: 0 })) } },
      { ...valid, parent: { ...valid.parent, display: 1 } },
      { ...valid, artboard: { ...box, height: -1 } },
      { ...valid, siblings: [{ bgId: "", rect: box, label: "Card" }] },
      { ...valid, siblings: [{ bgId: "b", rect: box }] },
      { ...valid, siblings: "none" },
    ]) expect(parseFrameSnapRects(broken)).toBeNull();
  });

  test("Given oversized lists and labels When parsed Then they are cut to the limits", () => {
    const many = { ...valid, siblings: Array.from({ length: 200 }, (_, index) => ({ bgId: `s${index}`, rect: box, label: "x".repeat(100) })) };
    const parsed = parseFrameSnapRects(many)!;
    expect(parsed.siblings).toHaveLength(FRAME_SNAP_SIBLING_LIMIT);
    expect(parsed.siblings[0]!.label).toHaveLength(40);
  });

  test("Given a frame window that refuses the message When snap rects are asked Then the answer is null instead of a rejection", async () => {
    const globals = globalThis as { window?: unknown };
    const hadWindow = "window" in globals, before = globals.window;
    globals.window = { setTimeout, clearTimeout };
    try {
      const frame = { contentWindow: { postMessage() { throw new Error("detached"); } } } as unknown as HTMLIFrameElement;
      expect(await requestFrameSnapRects(frame, "card")).toBeNull();
    } finally {
      if (hadWindow) globals.window = before; else delete globals.window;
    }
  });
});
