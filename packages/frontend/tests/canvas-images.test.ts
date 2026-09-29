import { expect, test } from "bun:test";
import { MAX_SHARED_CANVAS_FONTS, embedCssImages, fontFaceFamily, isProjectImageUrl, pruneUnusedFontFaces, readCanvasImage } from "../src/lib/canvas-images";

test("Given sandbox images, When resolving assets, Then only the current project is fetched and CSS images are embedded", async () => {
  const base = "http://127.0.0.1:14070/api/projects/one/fs/index.html";
  expect(isProjectImageUrl("assets/hero.png", base)).toBe(true);
  const alternative = "http://127.0.0.1:14070/api/projects/one/alternatives/alt-1/fs/index.html";
  expect(isProjectImageUrl("assets/hero.png", alternative)).toBe(true);
  expect(isProjectImageUrl("/api/projects/one/alternatives/alt-2/fs/hero.png", alternative)).toBe(false);
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

test("Given the bundled shared fonts.css When its distinct woff2 faces are counted Then every face fits the window-shared canvas font cache", async () => {
  // Every new project receives this stylesheet with each face rewritten to a distinct /runtime/fonts URL.
  const css = await Bun.file(`${import.meta.dir}/../../../assets/fonts/fonts.css`).text();
  const faces = new Set(Array.from(css.matchAll(/url\('\.\/([^']+\.woff2)'\)/g), match => match[1]));
  expect(faces.size).toBeGreaterThan(0);
  expect(faces.size).toBeLessThan(MAX_SHARED_CANVAS_FONTS);
});

test("Given @font-face rules When families are read Then quoted, single-quoted and bare names parse and a nameless face is kept", () => {
  expect(fontFaceFamily('@font-face{font-family:"Brand Sans";src:url(a.woff2)}')).toBe("brand sans");
  expect(fontFaceFamily("@font-face{font-family:'Mono';src:url(b.woff2)}")).toBe("mono");
  expect(fontFaceFamily("@font-face{font-family: Serif Two ;src:url(c.woff2)}")).toBe("serif two");
  expect(fontFaceFamily("@font-face{src:url(d.woff2)}")).toBeNull();
});

test("Given faces used directly, through a token, from script, or not at all When pruned Then only unreferenced faces are removed", () => {
  const faces = '@font-face{font-family:"Used";src:url(u)}@font-face{font-family:"Token";src:url(t)}@font-face{font-family:"Scripted";src:url(s)}@font-face{font-family:"Unused";src:url(x)}@font-face{src:url(n)}';
  const [pruned] = pruneUnusedFontFaces([`${faces}h1{font-family:Used}:root{--font-display:"Token",serif}`], 'ctx.font = "12px Scripted"');
  expect(pruned).toContain('font-family:"Used"');
  expect(pruned).toContain('font-family:"Token"');
  expect(pruned).toContain('font-family:"Scripted"');
  expect(pruned).toContain("src:url(n)");
  expect(pruned).not.toContain("Unused");
  expect(pruneUnusedFontFaces(['@font-face{font-family:"Only";src:url(o)}', "p{font-family:only}"], "")[0]).toContain('"Only"');
});
