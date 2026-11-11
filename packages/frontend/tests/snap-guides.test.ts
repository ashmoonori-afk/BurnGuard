import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SnapGuides from "../src/components/canvas/SnapGuides";
import { MagnetStatusSection } from "../src/components/modes/TweaksPanel";
import { primaryGuides, snapGuideChip, snapGuideStatus } from "../src/lib/snap-guides";
import type { SnapGuide } from "../src/lib/snap-engine";
import { useUIStore } from "../src/state/uiStore";

const line = (overrides: Partial<Extract<SnapGuide, { kind: "line" }>> = {}): SnapGuide => ({ kind: "line", axis: "x", position: 200, source: "sibling", part: "start", from: 100, to: 340, bgId: "card-2", ...overrides });
const gap: SnapGuide = { kind: "gap", axis: "x", value: 24.04, cross: 25, segments: [{ from: 100, to: 124 }, { from: 224, to: 248 }] };
const names = new Map([["card-2", "Card 2"]]);

test("Given a guide When its chip is named Then edges, centres, grid tracks and gaps each get their own message", () => {
  expect(snapGuideChip(line())).toEqual({ key: "canvas.snap.left" });
  expect(snapGuideChip(line({ part: "center" }))).toEqual({ key: "canvas.snap.center" });
  expect(snapGuideChip(line({ part: "end" }))).toEqual({ key: "canvas.snap.right" });
  expect(snapGuideChip(line({ axis: "y", part: "start" }))).toEqual({ key: "canvas.snap.top" });
  expect(snapGuideChip(line({ axis: "y", part: "center" }))).toEqual({ key: "canvas.snap.middle" });
  expect(snapGuideChip(line({ axis: "y", part: "end" }))).toEqual({ key: "canvas.snap.bottom" });
  expect(snapGuideChip(line({ source: "grid", track: 3 }))).toEqual({ key: "canvas.snap.column", params: { n: 3 } });
  expect(snapGuideChip(line({ source: "grid", axis: "y", track: 2 }))).toEqual({ key: "canvas.snap.row", params: { n: 2 } });
  expect(snapGuideChip(gap)).toEqual({ key: "canvas.snap.px", params: { value: 24 } });
  expect(snapGuideChip({ kind: "size", axis: "x", value: 100, bgId: "card-2" }, names)).toEqual({ key: "canvas.snap.sameWidth", params: { name: "Card 2" } });
  expect(snapGuideChip({ kind: "size", axis: "y", value: 100, bgId: "card-2" }, names)).toEqual({ key: "canvas.snap.sameHeight", params: { name: "Card 2" } });
  expect(snapGuideChip({ kind: "size", axis: "x", value: 100, bgId: "card-2" })).toEqual({ key: "canvas.snap.sameWidthNeighbor" });
  expect(snapGuideChip({ kind: "size", axis: "y", value: 100, bgId: "unknown" }, names)).toEqual({ key: "canvas.snap.sameHeightNeighbor" });
  expect(snapGuideChip({ kind: "angle", value: 45 })).toEqual({ key: "canvas.snap.degrees", params: { value: 45 } });
});

test("Given a guide When its sentence is built Then it names what the element locked to", () => {
  expect(snapGuideStatus(line(), "left", names)).toEqual({ key: "canvas.snap.alignedSibling", params: { part: "left", name: "Card 2" } });
  expect(snapGuideStatus(line({ bgId: "unknown" }), "left", names)).toEqual({ key: "canvas.snap.alignedNeighbor", params: { part: "left" } });
  expect(snapGuideStatus(line({ source: "parent", bgId: undefined }), "center", names)).toEqual({ key: "canvas.snap.alignedParent", params: { part: "center" } });
  expect(snapGuideStatus(line({ source: "artboard", bgId: undefined }), "center", names)).toEqual({ key: "canvas.snap.alignedArtboard", params: { part: "center" } });
  expect(snapGuideStatus(line({ source: "grid", track: 3 }), "column 3", names)).toEqual({ key: "canvas.snap.alignedGrid", params: { line: "column 3" } });
  expect(snapGuideStatus(gap, "24 px", names)).toEqual({ key: "canvas.snap.equalGap", params: { value: 24 } });
  expect(snapGuideStatus({ kind: "size", axis: "x", value: 248.04, bgId: "card-2" }, "", names)).toEqual({ key: "canvas.snap.widthMatches", params: { name: "Card 2", value: 248 } });
  expect(snapGuideStatus({ kind: "size", axis: "y", value: 180, bgId: "card-2" }, "", names)).toEqual({ key: "canvas.snap.heightMatches", params: { name: "Card 2", value: 180 } });
  expect(snapGuideStatus({ kind: "size", axis: "x", value: 100, bgId: "unknown" }, "", names)).toEqual({ key: "canvas.snap.widthMatchesNeighbor", params: { value: 100 } });
  expect(snapGuideStatus({ kind: "size", axis: "y", value: 100, bgId: "unknown" }, "", names)).toEqual({ key: "canvas.snap.heightMatchesNeighbor", params: { value: 100 } });
  expect(snapGuideStatus({ kind: "angle", value: 45 }, "", names)).toEqual({ key: "canvas.snap.rotationLocked", params: { value: 45 } });
});

test("Given guides at 200% zoom When drawn Then each lock is one labelled element with a one-screen-pixel line, hidden from assistive technology", () => {
  const box = { left: 200, top: 120, width: 100, height: 60 };
  const html = renderToStaticMarkup(createElement(SnapGuides, { guides: [line(), gap], box, names, zoom: 2, live: true, onFaded() {} }));
  expect(html.match(/data-snap-guide="[^"]+"/g)).toEqual(['data-snap-guide="canvas.snap.left"', 'data-snap-guide="canvas.snap.px"']);
  expect(html).toContain("left:199.75px;top:100px;width:0.5px;height:240px");
  expect(html).toContain("left:224px;top:24.75px;width:24px;height:0.5px");
  // The chip sits beside the moved box, not at the far end of a long guide.
  expect(html).toContain("left:200px;top:120px;transform:translate(-50%, -100%) scale(0.5)");
  expect(renderToStaticMarkup(createElement(SnapGuides, { guides: [line({ axis: "y", position: 300 })], box, names, zoom: 1, live: true, onFaded() {} }))).toContain("left:200px;top:300px;transform:translate(-100%, -50%) scale(1)");
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain("opacity-0");
  expect(renderToStaticMarkup(createElement(SnapGuides, { guides: [line()], box, names, zoom: 1, live: false, onFaded() {} }))).toContain("opacity-0");
  expect(renderToStaticMarkup(createElement(SnapGuides, { guides: [], box, names, zoom: 1, live: true, onFaded() {} }))).toBe("");
});

test("Given a same-size lock or a rotation lock When drawn Then a badge sits under or beside the box and the angle above it", () => {
  const box = { left: 200, top: 120, width: 100, height: 60 };
  const draw = (guide: SnapGuide) => renderToStaticMarkup(createElement(SnapGuides, { guides: [guide], box, names, zoom: 1, live: true, onFaded() {} }));
  const width = draw({ kind: "size", axis: "x", value: 100, bgId: "card-2" });
  expect(width).toContain('data-snap-guide="canvas.snap.sameWidth"');
  expect(width).toContain("left:250px;top:204px;transform:translate(-50%, 0) scale(1)");
  expect(width).toContain("Card 2");
  const height = draw({ kind: "size", axis: "y", value: 60, bgId: "card-2" });
  expect(height).toContain("left:324px;top:150px;transform:translate(0, -50%) scale(1)");
  const angle = draw({ kind: "angle", value: 45 });
  expect(angle).toContain('data-snap-guide="canvas.snap.degrees"');
  expect(angle).toContain("left:250px;top:84px;transform:translate(-50%, -100%) scale(1)");
});

test("Given several coinciding lines When the overlay picks what to show Then each direction keeps its deciding line and every spacing lock", () => {
  const top = line({ axis: "y", part: "start" }), bottom = line({ axis: "y", part: "end" }), right = line({ part: "end" });
  expect(primaryGuides([line(), right, gap, top, bottom])).toEqual([line(), gap, top]);
  expect(primaryGuides([])).toEqual([]);
});

const magnetStatus = (magnet: boolean, status: string | null) => renderToStaticMarkup(createElement(MagnetStatusSection, { magnet, status })).match(/<p role="status" aria-live="polite" data-magnet-status="([^"]+)"[^>]*>([^<]*)<\/p>/)?.slice(1) ?? null;

test("Given the Style panel When the magnet locks, idles or is off Then a polite status line says so in words", () => {
  expect(magnetStatus(true, null)?.[0]).toBe("idle");
  expect(magnetStatus(true, "Aligned to the left of Card 2.")).toEqual(["locked", "Aligned to the left of Card 2."]);
  expect(magnetStatus(false, "Aligned to the left of Card 2.")?.[0]).toBe("off");
  expect(magnetStatus(false, null)?.[1]).not.toBe(magnetStatus(true, null)?.[1]);
});

test("Given the snap status in the UI store When it is set and cleared Then the state follows", () => {
  useUIStore.getState().setCanvasSnapStatus("locked");
  expect(useUIStore.getState().canvasSnapStatus).toBe("locked");
  useUIStore.getState().setCanvasSnapStatus(null);
  expect(useUIStore.getState().canvasSnapStatus).toBeNull();
});
