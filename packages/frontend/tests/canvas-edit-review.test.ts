import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import type { KeyboardEvent } from "react";
import { commitTweakOnBlur, handleEnterEscape } from "../src/components/modes/TweaksPanel";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { loadFilePreview } from "../src/components/files/FilePreview";

describe("canvas review regressions", () => {
  test.each(["Enter", "Escape"])("Given a changed style When %s synchronously blurs Then it commits once or cancels", (key) => {
    let commits = 0;
    let cancels = 0;
    const commit = () => { commits += 1; };
    const input = { blur: () => commitTweakOnBlur(input as HTMLInputElement, commit) };
    handleEnterEscape({ key, currentTarget: input, preventDefault() {} } as unknown as KeyboardEvent<HTMLInputElement>, commit, () => { cancels += 1; });
    expect(commits).toBe(key === "Enter" ? 1 : 0);
    expect(cancels).toBe(key === "Escape" ? 1 : 0);
    // The suppression belongs to this keyboard blur only; later normal edits save.
    commitTweakOnBlur(input as HTMLInputElement, commit);
    expect(commits).toBe(key === "Enter" ? 2 : 1);
  });

  test.each([[3, 9, 2], [0, 9, -1], [3, 0, 0]])("Given %i slides When restoring %i Then the bridge returns actual index %i", (count, requested, expected) => {
    const html = buildSandboxedArtifactSrcDoc("<html><head></head><body></body></html>", "http://localhost/artifact.html");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    const listeners = new Map<string, (event: unknown) => void>();
    const replies: Array<{ type: string; payload: unknown }> = [];
    const slides = Array.from({ length: count }, () => ({ active: false, setAttribute() { this.active = true; }, removeAttribute() { this.active = false; } }));
    const parent = { postMessage: (message: { type: string; payload: unknown }) => replies.push(message) };
    const location = { href: "about:srcdoc", hash: "" };
    runInNewContext(script!, {
      window: { parent, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), dispatchEvent() {
        const active = Number(location.hash.replace("#slide-", "")) - 1;
        slides.forEach((slide, index) => { slide.active = index === active; });
      } },
      document: { readyState: "loading", addEventListener() {}, querySelectorAll: () => slides, querySelector: () => slides.find((slide) => slide.active) ?? null },
      location,
      history: { replaceState(_state: unknown, _title: string, url: string) {
        assertSrcdocUrl(url);
        location.href = url;
        location.hash = url.slice(url.indexOf("#"));
      } },
      HashChangeEvent: class {},
    });
    listeners.get("message")!({ source: parent, data: { __bgFrameBridge: true, type: "request", requestId: "restore", action: "set-active-slide", payload: { slideIndex: requested } } });
    expect(replies.find((reply) => reply.type === "response")?.payload).toBe(expected);
    if (expected >= 0) expect(slides[expected]!.active).toBe(true);
  });

  test("Given a real text file When preview loads Then it forwards cancellation and bypasses stale cache", async () => {
    const controller = new AbortController();
    const preview = await loadFilePreview("project", { rel_path: "notes/a b.md", category: "document" }, controller.signal, async (url, init) => {
      expect(url).toBe("/api/projects/project/fs/notes/a%20b.md");
      expect(init?.signal).toBe(controller.signal);
      expect(init?.cache).toBe("no-store");
      return new Response("새로운 파일 내용", { headers: { "content-type": "text/plain; charset=utf-8" } });
    });
    expect(preview).toEqual({ kind: "text", text: "새로운 파일 내용", truncated: false });
  });

  test("Given an image When preview loads Then its bytes stay in an image blob", async () => {
    const preview = await loadFilePreview("project", { rel_path: "image.svg", category: "asset" }, new AbortController().signal, async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { "content-type": "image/svg+xml" } }));
    expect(preview.kind).toBe("image");
    if (preview.kind === "image") expect(preview.blob.type).toBe("image/svg+xml");
  });

  test("Given a missing file When preview loads Then raw server detail is not propagated", async () => {
    await expect(loadFilePreview("project", { rel_path: "missing.txt", category: "document" }, new AbortController().signal, async () => new Response("C:\\private\\secret", { status: 404 }))).rejects.toMatchObject({ status: 404, message: "File preview unavailable" });
  });

  test("Given an image without a length header When streaming exceeds 20MB Then preview cancels the remaining body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    const preview = await loadFilePreview("project", { rel_path: "huge.png", category: "asset" }, new AbortController().signal,
      async () => new Response(body, { headers: { "content-type": "image/png" } }));
    expect(preview).toEqual({ kind: "unsupported" });
    expect(cancelled).toBe(true);
  });

  test("Given a large text file When preview loads Then it stops at the preview limit", async () => {
    const preview = await loadFilePreview("project", { rel_path: "large.txt", category: "document" }, new AbortController().signal, async () => new Response("x".repeat(1024 * 1024 + 10), { headers: { "content-type": "text/plain" } }));
    expect(preview.kind).toBe("text");
    if (preview.kind === "text") {
      expect(preview.text.length).toBe(1024 * 1024);
      expect(preview.truncated).toBe(true);
    }
  });

  test("Given a cancelled file request When it is superseded Then cancellation reaches the caller", async () => {
    const controller = new AbortController();
    const pending = loadFilePreview("project", { rel_path: "old.txt", category: "document" }, controller.signal, async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

function assertSrcdocUrl(url: string) {
  // A relative fragment resolves through the injected artifact <base> and
  // throws SecurityError in a real sandboxed srcdoc iframe.
  expect(url.startsWith("about:srcdoc#slide-")).toBe(true);
}
