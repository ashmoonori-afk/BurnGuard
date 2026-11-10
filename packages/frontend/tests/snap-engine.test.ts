import { expect, test } from "bun:test";
import { collectCandidates, resolveSnap, snapRotation, snapThreshold, type SnapKind, type SnapRect, type SnapSources } from "../src/lib/snap-engine";

const rect = (left: number, top: number, width: number, height: number): SnapRect => ({ left, top, width, height });
const NONE: SnapSources = { parent: null, artboard: null, siblings: [] };
const withSiblings = (...rects: SnapRect[]): SnapSources => ({ ...NONE, siblings: rects.map((sibling, index) => ({ bgId: `s${index}`, rect: sibling })) });
const snap = (sources: SnapSources, moving: SnapRect, options: { kind?: SnapKind; thresholdPx?: number; rotation?: number } = {}) =>
  resolveSnap({ moving, kind: "move", candidates: collectCandidates(sources), thresholdPx: 6, rotation: 0, ...options });

test("Given a sibling edge 3 px away When moving Then the box locks to it and the guide spans both boxes", () => {
  const result = snap(withSiblings(rect(200, 300, 100, 50)), rect(203, 100, 60, 40));
  expect(result.dx).toBe(-3);
  expect(result.dy).toBe(0);
  expect(result.guides).toEqual([{ kind: "line", axis: "x", position: 200, source: "sibling", part: "start", from: 100, to: 350, bgId: "s0" }]);
});

test("Given a sibling edge 7 px away When moving Then nothing locks", () => {
  expect(snap(withSiblings(rect(200, 300, 100, 50)), rect(207, 100, 60, 40))).toEqual({ dx: 0, dy: 0, guides: [] });
});

test("Given two edges within reach When moving Then the nearer one wins", () => {
  const result = snap(withSiblings(rect(200, 300, 100, 50), rect(204, 400, 100, 50)), rect(203, 100, 60, 40));
  expect(result.dx).toBe(1);
  expect(result.guides).toMatchObject([{ bgId: "s1", part: "start" }]);
});

test("Given two lines equally near When moving Then the tie follows grid, artboard, parent, sibling with centres before edges of the frame", () => {
  // Parent start edge (-3) and parent centre (+3): the centre wins although the edge is listed first.
  const parent = { content: rect(100, 0, 400, 600), columnLines: [], rowLines: [] };
  expect(snap({ ...NONE, parent }, rect(103, 200, 388, 40))).toMatchObject({ dx: 3, guides: [{ source: "parent", part: "center" }] });
  // Artboard centre (-3) beats a sibling edge (+3).
  const mixed = { ...withSiblings(rect(506, 400, 200, 50)), artboard: rect(0, 0, 1000, 600) };
  expect(snap(mixed, rect(473, 200, 60, 40))).toMatchObject({ dx: -3, guides: [{ source: "artboard", part: "center" }] });
  // A grid line (-3) beats a sibling edge (+3).
  const grid = { ...withSiblings(rect(122, 400, 300, 50)), parent: { content: rect(0, 0, 332, 600), columnLines: [{ start: 0, end: 0 }, { start: 100, end: 116 }, { start: 216, end: 232 }, { start: 332, end: 332 }], rowLines: [] } };
  expect(snap(grid, rect(119, 200, 20, 40))).toMatchObject({ dx: -3, guides: [{ source: "grid", part: "start", track: 2 }] });
});

test("Given a grid with a gap When candidates are collected Then each track contributes its start and its end", () => {
  const parent = { content: rect(0, 0, 332, 100), columnLines: [{ start: 0, end: 0 }, { start: 100, end: 116 }, { start: 216, end: 232 }, { start: 332, end: 332 }], rowLines: [] };
  const lines = collectCandidates({ ...NONE, parent }).lines.filter((line) => line.source === "grid");
  expect(lines.map((line) => [line.position, line.part, line.track])).toEqual([[0, "start", 1], [116, "start", 2], [100, "end", 1], [232, "start", 3], [216, "end", 2], [332, "end", 3]]);
  const flush = collectCandidates({ ...NONE, parent: { ...parent, columnLines: [{ start: 0, end: 0 }, { start: 100, end: 100 }, { start: 200, end: 200 }] } }).lines.filter((line) => line.source === "grid");
  expect(flush.map((line) => [line.position, line.part, line.track])).toEqual([[0, "start", 1], [100, "start", 2], [200, "end", 2]]);
});

test("Given the zoom When the threshold is derived Then 6 screen px is 3 canvas px at 200%", () => {
  expect(snapThreshold(1)).toBe(6);
  expect(snapThreshold(2)).toBe(3);
  expect(snapThreshold(0)).toBe(6);
  const sources = withSiblings(rect(200, 300, 100, 50));
  expect(snap(sources, rect(204, 100, 60, 40), { thresholdPx: snapThreshold(1) }).dx).toBe(-4);
  expect(snap(sources, rect(204, 100, 60, 40), { thresholdPx: snapThreshold(2) }).dx).toBe(0);
});

test("Given a box rotated 30 degrees When moving Then only its centre locks, and a quarter turn locks edges again", () => {
  const sources = withSiblings(rect(200, 300, 100, 50));
  expect(snap(sources, rect(203, 100, 60, 40), { rotation: 30 })).toEqual({ dx: 0, dy: 0, guides: [] });
  expect(snap(sources, rect(223, 100, 60, 40), { rotation: 30 })).toMatchObject({ dx: -3, guides: [{ part: "center" }] });
  expect(snap(sources, rect(203, 100, 60, 40), { rotation: 90 }).dx).toBe(-3);
  expect(snap(sources, rect(203, 100, 60, 40), { rotation: -270 }).dx).toBe(-3);
});

test("Given a sibling 3 px wider When resizing from the east handle Then the width locks to the same width", () => {
  const result = snap(withSiblings(rect(500, 300, 100, 50)), rect(0, 0, 97, 40), { kind: "resize-e" });
  expect(result).toEqual({ dx: 3, dy: 0, guides: [{ kind: "size", axis: "x", value: 100, bgId: "s0" }] });
  expect(snap(withSiblings(rect(500, 300, 100, 53)), rect(0, 0, 97, 50), { kind: "resize-se" })).toMatchObject({ dx: 3, dy: 3 });
});

test("Given a resize When only the east edge moves Then the other edges and the other axis never lock", () => {
  // The left edge sits 3 px from a sibling edge, the bottom edge 3 px from another: neither is the moving edge.
  const sources = withSiblings(rect(3, 43, 300, 20));
  expect(snap(sources, rect(0, 0, 60, 40), { kind: "resize-e" })).toEqual({ dx: 0, dy: 0, guides: [] });
  // The east edge ends 4 px before the sibling's right edge.
  expect(snap(withSiblings(rect(50, 300, 153, 50)), rect(0, 0, 199, 40), { kind: "resize-e" })).toMatchObject({ dx: 4, guides: [{ kind: "line", part: "end" }] });
  expect(snap(sources, rect(0, 0, 60, 40), { kind: "resize-s" })).toMatchObject({ dx: 0, dy: 3 });
  // A rotated box grows on both sides of its centre, so resizing it does not lock.
  expect(snap(withSiblings(rect(50, 300, 153, 50)), rect(0, 0, 199, 40), { kind: "resize-e", rotation: 90 }).dx).toBe(0);
});

test("Given two siblings 24 px apart When moving next to them Then the box locks to the same gap and reports both gaps", () => {
  const sources = withSiblings(rect(0, 0, 100, 50), rect(124, 0, 100, 50));
  const after = snap(sources, rect(250, 10, 100, 30));
  expect(after.dx).toBe(-2);
  expect(after.guides).toContainEqual({ kind: "gap", axis: "x", value: 24, cross: 25, segments: [{ from: 100, to: 124 }, { from: 224, to: 248 }] });
  const before = snap(sources, rect(-126, 10, 100, 30));
  expect(before.dx).toBe(2);
  expect(before.guides).toContainEqual({ kind: "gap", axis: "x", value: 24, cross: 25, segments: [{ from: 100, to: 124 }, { from: -24, to: 0 }] });
  // A box in another row is not spaced against them.
  expect(snap(sources, rect(250, 200, 100, 30)).dx).toBe(0);
});

test("Given a sibling of the same size When the box locks Then every coinciding line is drawn once", () => {
  const result = snap(withSiblings(rect(200, 300, 100, 50)), rect(202, 100, 100, 40));
  expect(result.dx).toBe(-2);
  expect(result.guides.map((guide) => guide.kind === "line" ? guide.part : guide.kind)).toEqual(["start", "end", "center"]);
});

test("Given no candidates When resolving Then the box is returned unchanged", () => {
  expect(snap(NONE, rect(10, 10, 100, 40))).toEqual({ dx: 0, dy: 0, guides: [] });
  expect(collectCandidates(NONE)).toEqual({ lines: [], siblings: [] });
});

test("Given a rotation When it comes within 3 degrees of a multiple of 15 Then it locks to it, and stays free otherwise", () => {
  expect(snapRotation(43)).toEqual({ degrees: 45, locked: true });
  expect(snapRotation(48)).toEqual({ degrees: 45, locked: true });
  expect(snapRotation(41.9)).toEqual({ degrees: 41.9, locked: false });
  expect(snapRotation(-2)).toMatchObject({ locked: true });
  expect(Math.abs(snapRotation(-2).degrees)).toBe(0);
  expect(snapRotation(-178)).toEqual({ degrees: -180, locked: true });
  expect(snapRotation(22.5)).toEqual({ degrees: 22.5, locked: false });
});
