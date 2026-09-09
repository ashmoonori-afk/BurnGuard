import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UserMessage from "../src/components/chat/blocks/UserMessage";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { canvasPoint } from "../src/components/canvas/canvas-coordinates";
import { buildCommentEditRequest, commentEditDisplayText, saveAndRequestCommentEdit } from "../src/components/modes/comment-edit-request";
import { parseLocalFonts, type Comment } from "@bg/shared";

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
  expect(text).toContain("수정한 현재 파일을 직접 브라우저로 렌더링하고 스크린샷을 확인하세요");
  expect(text).toContain("허용된 다른 로컬 브라우저나 렌더링 도구");
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
