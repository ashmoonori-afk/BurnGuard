import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UserMessage from "../src/components/chat/blocks/UserMessage";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { canvasPoint } from "../src/components/canvas/canvas-coordinates";
import { buildCommentEditRequest, commentEditDisplayText, saveAndRequestCommentEdit } from "../src/components/modes/comment-edit-request";
import { parseLocalFonts, type Comment } from "@bg/shared";
import { identityForPatch, type FileArtifactIdentity } from "../src/lib/artifact-identity";
import { dimensionPatch, nudgeTravel, rotationPatch, translatePatch } from "../src/lib/element-geometry";
import { heldGuides, snapResize, snapRotate } from "../src/lib/resize-gesture";
import { collectCandidates } from "../src/lib/snap-engine";
import type { TweaksTarget } from "../src/components/canvas/TweaksLayer";
import { arrowStep, beginMoveGesture, type MoveGestureStart } from "../src/lib/move-gesture";
import type { SnapSources } from "../src/lib/snap-engine";

test("Given a zoomed and moved canvas When pointing Then hit and draw coordinates remain unscaled", () => {
  const element = { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ left: 120, top: 70, width: 400, height: 300 }) } as HTMLElement;
  expect(canvasPoint(element, 220, 145)).toEqual([200, 150]);
});

test("Given persisted comment identity When explicitly sent Then the request contains file, element and revision", () => {
  const comment = { id: "c1", rel_path: "index.html", node_selector: "#hero", slide_index: 0, artifact_revision: 7, artifact_digest: "abc", body: "Make this blue" } as Comment;
  const request = JSON.parse(buildCommentEditRequest(comment).split("\n")[1]!);
  expect(request).toEqual({ comment_id: "c1", file: "index.html", element: "#hero", slide_index: 0, artifact_revision: 7, artifact_digest: "abc", request: "Make this blue" });
});

test("Given an image regeneration comment When sent Then prompt approval precedes generation and direct render verification", () => {
  const text = buildCommentEditRequest({ body: "이미지 재생성" } as Comment);
  expect(text).toContain("'기존 프롬프트'");
  expect(text).toContain("'수정 프롬프트'");
  expect(text).toContain("이 프롬프트로 재생성할까요?");
  expect(text).toContain("원문을 지어내지 마세요");
  expect(text).toContain("명시적인 확인을 받을 때까지 이미지 생성 도구를 호출하거나 파일을 변경하지 마세요");
  expect(text).toContain("이미 승인된 수정 프롬프트는 다시 묻지 말고 실행하세요");
  expect(text).toContain("내장 캔버스의 최신 preview-report.json");
  expect(text).not.toContain("직접 브라우저로 렌더링");
  expect(text).toContain("검증을 사용자에게 떠넘기거나 확인하지 않은 결과를 완료로 보고하지 마세요");
});

test("Given new and persisted legacy comment requests When rendered Then only file and request show while ordinary text remains intact", () => {
  const comment = { id: "private-comment-id", rel_path: "index.html", node_selector: '[data-bg-node-id="poster-image"]', slide_index: null, artifact_revision: 5, artifact_digest: "private-digest", body: '이미지 재생성\n중괄호 {내용}와 "인용" 유지' } as Comment;
  const current = buildCommentEditRequest(comment);
  const legacy = `다음 저장된 코멘트에 따라 대상 파일의 요소를 수정해 주세요. 현재 파일에서 대상을 먼저 확인하고 필요한 변경만 적용한 뒤 변경 파일과 결과를 알려 주세요.\n${current.split("\n")[1]}`;
  for (const text of [current, legacy]) {
    expect(commentEditDisplayText(text)).toBe(`코멘트 수정 · index.html\n${comment.body}`);
    const html = renderToStaticMarkup(createElement(UserMessage, { text, attachmentCount: 1, turnId: "turn", onRevert() {} }));
    for (const hidden of [comment.id, comment.artifact_digest!, "comment_id", "artifact_revision", "poster-image", "JSON을 그대로"]) expect(html).not.toContain(hidden);
    expect(html).toContain("코멘트 수정 · index.html");
    expect(html).toContain("이미지 재생성");
    expect(html).toContain("첨부 파일 1개");
    expect(html).toContain("이 턴 되돌리기");
  }
  expect(commentEditDisplayText(buildCommentEditRequest({ ...comment, slide_index: 0, artifact_revision: null, artifact_digest: null }))).toBe(`코멘트 수정 · index.html · 1번 슬라이드\n${comment.body}`);
  const header = current.split("\n")[0];
  const payload = JSON.parse(current.split("\n")[1]!);
  for (const text of ["이미지 재생성", JSON.stringify(payload), `${header}\n{invalid`, `${header}\nnull`, `${header}\n[]`, `${header}\n${JSON.stringify({ ...payload, request: {} })}`, `${header}\n${JSON.stringify({ ...payload, slide_index: -1 })}`, `${header}\n${JSON.stringify({ ...payload, extra: "preserve" })}`, `${current}\n사용자가 추가한 내용`]) {
    expect(commentEditDisplayText(text)).toBe(text);
  }
});

test("Given native font families When parsed Then deduplicated names exclude private paths", () => {
  expect(parseLocalFonts({ schema_version: 1, families: ["Segoe UI", "Arial", "Arial"] }).families).toEqual(["Arial", "Segoe UI"]);
  expect(() => parseLocalFonts({ schema_version: 1, families: ["C:\\private\\font.ttf"] })).toThrow();
});

test("Given an edited draft When explicitly requested Then persistence finishes before send and save failure prevents send", async () => {
  const events: string[] = [];
  const persisted = { id: "c1", body: "saved draft", rel_path: "index.html", node_selector: "#hero", resolved_at: null } as Comment;
  await saveAndRequestCommentEdit(async () => { events.push("saved"); return persisted; }, async (comment, text) => { events.push("sent"); expect(comment).toBe(persisted); expect(text).toContain("saved draft"); });
  expect(events).toEqual(["saved", "sent"]);
  await expect(saveAndRequestCommentEdit(async () => { throw new Error("save_failed"); }, async () => { events.push("unexpected"); })).rejects.toThrow("save_failed");
  expect(events).toEqual(["saved", "sent"]);
});

test("Given an overlay wheel When the tagged parent requests scrolling Then the nested scroller moves and foreign sources are ignored", () => {
  const script = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/file.html").match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const listeners = new Map<string, (event: unknown) => void>();
  const root = {};
  const node = { scrollLeft: 0, scrollTop: 0, parentElement: root };
  const parent = { postMessage() {} };
  let windowScroll = 0;
  runInNewContext(script, {
    window: { parent, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), getComputedStyle: () => ({ overflowY: "auto", overflowX: "auto" }), scrollBy: () => { windowScroll++; } },
    document: { readyState: "loading", addEventListener() {}, documentElement: root, elementFromPoint: () => node },
  });
  const data = { __bgFrameBridge: true, type: "request", requestId: "wheel", action: "scroll-at-point", payload: { x: 10, y: 20, deltaX: 0, deltaY: 80 } };
  listeners.get("message")!({ source: {}, data });
  expect(node.scrollTop).toBe(0);
  listeners.get("message")!({ source: parent, data });
  expect(node.scrollTop).toBe(80);
  expect(windowScroll).toBe(0);
});

const identityAt = (revision: number): FileArtifactIdentity => ({ expected_revision: revision, expected_artifact_digest: `digest-${revision}`, expected_file_hash: `hash-${revision}`, node_fingerprint: `node-${revision}` });
const NEIGHBOUR: SnapSources = { parent: null, artboard: null, siblings: [{ bgId: "next", rect: { left: 203, top: 300, width: 100, height: 40 } }] };

/** A move gesture on a 60 x 40 box at 100,100 whose snap rects have already arrived unless `sources` says otherwise. */
async function moveGesture(overrides: Partial<MoveGestureStart<FileArtifactIdentity>> = {}) {
  const start: MoveGestureStart<FileArtifactIdentity> = { rect: { left: 100, top: 100, width: 60, height: 40 }, rotation: 0, basis: undefined, offset: { x: 0, y: 0 }, zoom: 1, sources: Promise.resolve(NEIGHBOUR), identity: Promise.resolve(identityAt(1)), ...overrides };
  const gesture = beginMoveGesture(start);
  await start.sources.catch(() => null);
  return gesture;
}
const HALF = [0.5, 0, 0, 0.5] as const;
const pointer = (dx: number, dy = 0, options: { magnet?: boolean; paused?: boolean } = {}) => ({ dx, dy, magnet: true, paused: false, ...options });

test("Given a press that travels 2 px When released Then it is a click and nothing is saved", async () => {
  const gesture = await moveGesture();
  expect(gesture.update(pointer(2))).toBeNull();
  expect(gesture.dragging).toBe(false);
  expect(gesture.release()).toBeNull();
});

test("Given a 40 px drag When released Then exactly one save carries translate 40px 0px", async () => {
  const gesture = await moveGesture({ sources: Promise.resolve(null) });
  expect(gesture.update(pointer(40))).toMatchObject({ delta: { x: 40, y: 0 }, rect: { left: 140, top: 100 }, guides: [] });
  const commit = gesture.release()!;
  expect(translatePatch(commit.offset.x, commit.offset.y)).toEqual({ translate: "40px 0px" });
  expect(gesture.release()).toBeNull();
  expect(gesture.update(pointer(80))).toBeNull();
});

test("Given a sibling edge 3 px from where the pointer leaves the box When released Then the locked value is saved", async () => {
  const gesture = await moveGesture();
  const preview = gesture.update(pointer(100))!;
  expect(preview.guides).toMatchObject([{ kind: "line", bgId: "next", part: "start" }]);
  expect(preview.rect.left).toBe(203);
  expect(gesture.release()!.offset).toEqual({ x: 103, y: 0 });
});

test("Given the pause key or the magnet switched off When dragging next to a sibling Then the unlocked value is saved", async () => {
  const paused = await moveGesture();
  expect(paused.update(pointer(100, 0, { paused: true }))).toMatchObject({ guides: [], rect: { left: 200 } });
  expect(paused.release()!.offset).toEqual({ x: 100, y: 0 });
  const off = await moveGesture();
  off.update(pointer(100, 0, { magnet: false }));
  expect(off.release()!.offset).toEqual({ x: 100, y: 0 });
});

test("Given Escape during a drag When the pointer is released Then nothing is saved", async () => {
  const gesture = await moveGesture();
  gesture.update(pointer(40));
  gesture.cancel();
  expect(gesture.update(pointer(60))).toBeNull();
  expect(gesture.release()).toBeNull();
});

test("Given a drag that returns to its start When released Then nothing is saved", async () => {
  const gesture = await moveGesture({ sources: Promise.resolve(null) });
  gesture.update(pointer(40));
  gesture.update(pointer(0));
  expect(gesture.dragging).toBe(true);
  expect(gesture.release()).toBeNull();
});

test("Given a saved offset, a slide scaled to 50% and a 200% zoom When dragging Then the offset is in the element's own pixels and the click threshold stays 3 screen px", async () => {
  const scaled = await moveGesture({ offset: { x: 10, y: -5 }, basis: HALF, sources: Promise.resolve(null) });
  scaled.update(pointer(40, 20));
  expect(scaled.release()!.offset).toEqual({ x: 90, y: 35 });
  const zoomed = await moveGesture({ zoom: 2, sources: Promise.resolve(null) });
  expect(zoomed.update(pointer(1.4))).toBeNull();
  expect(zoomed.update(pointer(1.6))).not.toBeNull();
  // At 200% the magnet reaches 3 canvas px: a neighbour 4 px away does not lock.
  const far = await moveGesture({ zoom: 2 });
  expect(far.update(pointer(99))!.guides).toEqual([]);
  expect((await moveGesture()).update(pointer(99))!.guides).toHaveLength(1);
});

test("Given snap rects that never arrive or fail When dragging Then the element still moves without locking", async () => {
  const pending = beginMoveGesture({ rect: { left: 100, top: 100, width: 60, height: 40 }, rotation: 0, basis: undefined, offset: { x: 0, y: 0 }, zoom: 1, sources: new Promise(() => undefined), identity: Promise.resolve(identityAt(1)) });
  expect(pending.update(pointer(100))).toMatchObject({ guides: [], rect: { left: 200 } });
  const failed = await moveGesture({ sources: Promise.reject(new Error("bridge_failed")) });
  expect(failed.update(pointer(100))).toMatchObject({ guides: [], rect: { left: 200 } });
});

test("Given a newer identity at release When a gesture saves Then it sends the identity read at its start, and a panel field reads one at save time", async () => {
  let revision = 0;
  const readNow = async () => identityAt(++revision);
  const gesture = await moveGesture({ identity: readNow() });
  gesture.update(pointer(40));
  await readNow();
  const commit = gesture.release()!;
  expect(await identityForPatch(commit.identity, readNow)).toEqual(identityAt(1));
  expect(revision).toBe(2);
  expect(await identityForPatch(undefined, readNow)).toEqual(identityAt(3));
});

test("Given the identity read at gesture start failed When the gesture saves Then the save fails instead of reading a newer identity", async () => {
  let reads = 0;
  const gesture = await moveGesture({ identity: Promise.reject(new Error("node_not_found")) });
  gesture.update(pointer(40));
  const commit = gesture.release()!;
  await expect(identityForPatch(commit.identity, async () => { reads += 1; return identityAt(9); })).rejects.toThrow("node_not_found");
  expect(reads).toBe(0);
});

const CARD: TweaksTarget = { bg_id: "card", tag: "div", computed: { width: "200px", height: "100px" }, inline: {}, geometry: { width: 200, height: 100 } };
/** A 200 x 100 card at 100,100 with a 300 x 100 sibling below whose right edge is at x = 400. */
const BELOW = collectCandidates({ parent: null, artboard: null, siblings: [{ bgId: "wide", rect: { left: 100, top: 300, width: 300, height: 100 } }] });
const resize = (width: number, height: number, overrides: Partial<Parameters<typeof snapResize>[0]> = {}) =>
  snapResize({ handle: "e", rect: { left: 100, top: 100, width: 200, height: 100 }, width, height, scaleX: 1, scaleY: 1, rotation: 0, candidates: BELOW, zoom: 1, magnet: true, paused: false, ...overrides });

test("Given an east-handle drag that ends 4 px before a sibling's right edge When released Then the saved width meets the edge", () => {
  const snapped = resize(296, 100);
  expect(snapped.width).toBe(300);
  expect(snapped.guides.map((guide) => guide.kind)).toContain("line");
  expect(dimensionPatch(CARD, snapped.width, snapped.height, false)).toMatchObject({ width: "300px", height: "100px" });
});

test("Given the pause key, the magnet off or snap rects that have not arrived When resizing Then the size is the pointer's", () => {
  expect(resize(296, 100, { paused: true })).toEqual({ width: 296, height: 100, guides: [] });
  expect(resize(296, 100, { magnet: false })).toEqual({ width: 296, height: 100, guides: [] });
  expect(resize(296, 100, { candidates: null })).toEqual({ width: 296, height: 100, guides: [] });
});

test("Given a sibling of another width When the dragged width comes within reach Then it locks to the same width and names the sibling", () => {
  const far = collectCandidates({ parent: null, artboard: null, siblings: [{ bgId: "narrow", rect: { left: 900, top: 300, width: 150, height: 100 } }] });
  const snapped = resize(147, 100, { candidates: far });
  expect(snapped.width).toBe(150);
  expect(snapped.guides).toEqual([{ kind: "size", axis: "x", value: 150, bgId: "narrow" }]);
});

test("Given a slide scaled to 50% and a 200% zoom When resizing Then the lock is measured on screen and the size stays in the element's pixels", () => {
  // On screen the box is 100 px wide per 200 CSS px; the sibling edge at client x = 400 needs 600 CSS px.
  const scaled = resize(596, 100, { scaleX: 0.5, scaleY: 0.5 });
  expect(scaled.width).toBe(600);
  // 4 client px away is out of reach at 200% zoom (3 canvas px).
  expect(resize(296, 100, { zoom: 2 }).width).toBe(296);
});

test("Given an aspect-locked element When the east handle locks to an edge Then the ratio is kept", () => {
  const locked: TweaksTarget = { ...CARD, inline: { "aspect-ratio": "2 / 1" } };
  const snapped = resize(296, 100);
  expect(dimensionPatch(locked, snapped.width, snapped.height, true)).toMatchObject({ width: "300px", height: "150px", "aspect-ratio": "300 / 150" });
});

test("Given an aspect-locked element When the corner handle locks on both sides Then only the lock on the side that is kept is shown", () => {
  const locked: TweaksTarget = { ...CARD, inline: { "aspect-ratio": "2 / 1" } };
  // The pointer asks for 296 x 196: the width locks to the sibling's right edge (300) and the height to its top (200).
  const snapped = resize(296, 196, { handle: "se" });
  expect([snapped.width, snapped.height]).toEqual([300, 200]);
  expect(new Set(snapped.guides.map((guide) => "axis" in guide && guide.axis))).toEqual(new Set(["x", "y"]));
  // The height changed more, so it is kept and the width follows the ratio: 400 x 200. The width lock no longer holds.
  const patch = dimensionPatch(locked, snapped.width, snapped.height, true);
  expect(patch).toMatchObject({ width: "400px", height: "200px" });
  const held = heldGuides(snapped.guides, snapped, { width: 400, height: 200 });
  expect(held.length).toBeGreaterThan(0);
  expect(held.every((guide) => "axis" in guide && guide.axis === "y")).toBe(true);
  // Without the ratio lock both sides are saved as snapped, so every lock is shown.
  expect(heldGuides(snapped.guides, snapped, { width: 300, height: 200 })).toEqual(snapped.guides);
});

test("Given a rotate drag that ends at 43 degrees When released Then 45deg is saved, and 43deg with the pause key", () => {
  const rotate = (magnet: boolean, paused: boolean) => snapRotate({ degrees: 43, magnet, paused });
  expect(rotate(true, false)).toEqual({ degrees: 45, locked: true });
  expect(rotationPatch(rotate(true, false).degrees)).toEqual({ rotate: "45deg" });
  expect(rotationPatch(rotate(true, true).degrees)).toEqual({ rotate: "43deg" });
  expect(rotate(false, false)).toEqual({ degrees: 43, locked: false });
});

test("Given three Arrow Right presses and a key release When the burst ends Then exactly one save carries translate 3px 0px", async () => {
  const burst = await moveGesture({ clickThresholdScreenPx: 0, sources: Promise.resolve(null) });
  let x = 0;
  for (let press = 0; press < 3; press += 1) {
    x += arrowStep("ArrowRight", false)!.x;
    expect(burst.update(pointer(x))).not.toBeNull();
  }
  const commit = burst.release()!;
  expect(translatePatch(commit.offset.x, commit.offset.y)).toEqual({ translate: "3px 0px" });
  expect(burst.release()).toBeNull();
});

test("Given an arrow key When the step is read Then it is 1 px, 10 px with Shift, and nothing for other keys", () => {
  expect(arrowStep("ArrowDown", true)).toEqual({ x: 0, y: 10 });
  expect(arrowStep("ArrowUp", false)).toEqual({ x: 0, y: -1 });
  expect(arrowStep("ArrowLeft", true)).toEqual({ x: -10, y: 0 });
  expect(arrowStep("ArrowRight", false)).toEqual({ x: 1, y: 0 });
  expect(arrowStep("Enter", false)).toBeNull();
  expect(arrowStep("a", true)).toBeNull();
});

test("Given a nudge that lands 3 px from a sibling edge When it reports its locks Then it is not pulled, and on the edge it names the line", async () => {
  const near = await moveGesture({ clickThresholdScreenPx: 0 });
  expect(near.update({ ...pointer(40), reachPx: 0.01 })).toMatchObject({ rect: { left: 140 }, guides: [], offset: { x: 40, y: 0 } });
  const exact = await moveGesture({ clickThresholdScreenPx: 0 });
  expect(exact.update({ ...pointer(43), reachPx: 0.01 })).toMatchObject({ rect: { left: 143 }, guides: [{ kind: "line", bgId: "next" }] });
});

test("Given Alt or Option with an arrow When the next line is asked Then the burst jumps line by line, and stays put before the snap rects arrive", async () => {
  const burst = await moveGesture({ clickThresholdScreenPx: 0 });
  const first = burst.nextLine("x", 1);
  expect(first).toBe(43);
  burst.update({ ...pointer(first), reachPx: 0.01 });
  expect(burst.nextLine("x", 1)).toBe(30);
  expect(burst.nextLine("x", -1)).toBe(0);
  const early = beginMoveGesture({ rect: { left: 100, top: 100, width: 60, height: 40 }, rotation: 0, basis: undefined, offset: { x: 0, y: 0 }, zoom: 1, clickThresholdScreenPx: 0, sources: new Promise(() => undefined), identity: Promise.resolve(identityAt(1)) });
  expect(early.nextLine("x", 1)).toBe(0);
});

test("Given a slide scaled to 50% When one arrow press travels half a client pixel Then the saved offset moves one whole pixel", async () => {
  const burst = await moveGesture({ clickThresholdScreenPx: 0, basis: HALF, sources: Promise.resolve(null) });
  burst.update(pointer(nudgeTravel(HALF, arrowStep("ArrowRight", false)!).x));
  expect(burst.release()!.offset).toEqual({ x: 1, y: 0 });
});
