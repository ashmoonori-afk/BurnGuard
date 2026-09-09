import { expect, test } from "bun:test";
import { embedCssImages, isProjectImageUrl, readCanvasImage } from "../src/lib/canvas-images";

test("Given sandbox images, When resolving assets, Then only the current project is fetched and CSS images are embedded", async () => {
  const base = "http://127.0.0.1:14070/api/projects/one/fs/index.html";
  expect(isProjectImageUrl("assets/hero.png", base)).toBe(true);
  expect(isProjectImageUrl("http://[malformed", base)).toBe(false);
  for (const value of ["#gradient", "assets%2f..%2fsecret", "/api/projects/two/fs/hero.png", "../hero.png", "assets/../../hero.png", "https://example.com/hero.png", "//evil.test/hero.png", "data:image/png;base64,AA==", "/api/settings"]) expect(isProjectImageUrl(value, base)).toBe(false);
  const css = 'a{background:url("assets/hero.png")}b{background:url(https://example.com/image.png)}';
  expect(await embedCssImages(css, async url => isProjectImageUrl(url, base) ? "data:image/png;base64,AA==" : url)).toBe('a{background:url("data:image/png;base64,AA==")}b{background:url(https://example.com/image.png)}');
});

test("Given a shared byte budget, When another streamed image exceeds it, Then reading stops and sibling fetches are cancelled", async () => {
  const budget = { remaining: 5 };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  expect((await readCanvasImage(new Response(new Uint8Array(3)), budget, cancel)).size).toBe(3);
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(stream) { stream.enqueue(new Uint8Array(3)); },
    cancel() { cancelled = true; },
  }));
  await expect(readCanvasImage(response, budget, cancel)).rejects.toThrow("artifact_image_limit");
  expect(budget.remaining).toBe(2);
  expect(controller.signal.aborted).toBe(true);
  expect(cancelled).toBe(true);
});

test("Given project font CSS, When resolving nested font files, Then stylesheet-relative fonts stay within the project and retain font MIME", async () => {
  const stylesheet = "http://127.0.0.1:14070/api/projects/one/fs/fonts/fonts.css";
  const requested: string[] = [];
  const css = '@font-face{font-family:"DM Sans";src:url("./dm-sans.woff2")}a{src:url("../../../../two/fs/font.woff2")}b{src:url("https://example.com/font.woff2")}';
  const embedded = await embedCssImages(css, async source => {
    if (!isProjectImageUrl(source, stylesheet)) return source;
    requested.push(new URL(source, stylesheet).href);
    const budget = { remaining: 10 };
    const font = await readCanvasImage(new Response(new Uint8Array(3), { headers: { "content-type": "font/woff2" } }), budget, () => {});
    expect(font.type).toBe("font/woff2");
    expect(budget.remaining).toBe(7);
    return "data:font/woff2;base64,AAAA";
  });
  expect(requested).toEqual(["http://127.0.0.1:14070/api/projects/one/fs/fonts/dm-sans.woff2"]);
  expect(embedded).toContain('src:url("data:font/woff2;base64,AAAA")');
  expect(embedded).toContain('url("../../../../two/fs/font.woff2")');
});
