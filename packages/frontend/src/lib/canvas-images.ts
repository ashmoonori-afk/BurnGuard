import { authorizedFetch } from "@/api/client";

export function isProjectImageUrl(value: string, documentUrl: string): boolean {
  if (value.startsWith("#")) return false;
  try {
    const document = new URL(documentUrl);
    const root = document.pathname.match(/^\/api\/projects\/[^/]+\/fs\//)?.[0];
    const image = new URL(value, document);
    return root !== undefined && image.origin === document.origin && image.pathname.startsWith(root) && !/%(?:2f|5c)/i.test(image.pathname);
  } catch { return false; }
}

export async function embedCssImages(css: string, resolve: (url: string) => Promise<string>): Promise<string> {
  const matches = Array.from(css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi));
  const replacements = await Promise.all(matches.map(async (match) => {
    const source = match[1] ?? match[2] ?? match[3] ?? "";
    const resolved = await resolve(source);
    return resolved === source ? match[0] : `url("${resolved}")`;
  }));
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index]!;
    css = css.slice(0, match.index) + replacements[index] + css.slice(match.index! + match[0].length);
  }
  return css;
}

export async function readCanvasImage(response: Response, budget: { remaining: number }, cancel: () => void): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("artifact_image_empty");
  const chunks: ArrayBuffer[] = [];
  try {
    if (Number(response.headers.get("content-length")) > budget.remaining) {
      cancel();
      throw new Error("artifact_image_limit");
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > budget.remaining) {
        cancel();
        throw new Error("artifact_image_limit");
      }
      budget.remaining -= value.byteLength;
      chunks.push(new Uint8Array(value).buffer);
    }
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Inline project images, fonts and linked CSS: opaque frames cannot send Strict cookies. */
export async function embedCanvasImages(html: string, documentUrl: string, signal: AbortSignal): Promise<string> {
  const document = new DOMParser().parseFromString(html, "text/html");
  const fetched = new Map<string, Promise<string>>();
  const resources = new AbortController();
  const boundedSignal = AbortSignal.any([signal, resources.signal, AbortSignal.timeout(15000)]);
  const budget = { remaining: 32 * 1024 * 1024 };
  const resolve = async (source: string, base = documentUrl, stylesheet = false): Promise<string> => {
    if (!source || !isProjectImageUrl(source, base)) return source;
    const url = new URL(source, base).href;
    const key = `${stylesheet ? "css:" : "asset:"}${url}`;
    let pending = fetched.get(key);
    if (!pending) {
      if (fetched.size >= 64) { resources.abort(); throw new Error("artifact_image_limit"); }
      pending = (async () => {
        const response = await authorizedFetch(url, { signal: boundedSignal, redirect: "error" });
        if (!response.ok) throw Object.assign(new Error("artifact_image_load_failed"), { httpStatus: response.status });
        const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (stylesheet ? mime !== "text/css" : !/^(?:image\/|font\/(?:woff2?|ttf|otf)$|application\/(?:font-woff|vnd.ms-fontobject)$)/.test(mime)) { await response.body?.cancel(); return source; }
        const blob = await readCanvasImage(response, budget, () => resources.abort());
        if (stylesheet) return blob.text();
        return new Promise<string>((done, reject) => {
          const reader = new FileReader();
          reader.onload = () => done(String(reader.result));
          reader.onerror = () => reject(new Error("artifact_image_read_failed"));
          reader.readAsDataURL(blob);
        });
      })().catch((error: unknown) => { resources.abort(); throw error; });
      fetched.set(key, pending);
    }
    return pending;
  };
  await Promise.all(Array.from(document.querySelectorAll("img[src], input[type=image][src]")).map(async image => {
    image.setAttribute("src", await resolve(image.getAttribute("src")!));
  }));
  await Promise.all(Array.from(document.querySelectorAll("img[srcset], source[srcset]")).map(async image => {
    const srcset = image.getAttribute("srcset")!;
    // Data URLs contain commas and already work in the opaque frame.
    if (srcset.includes("data:")) return;
    image.setAttribute("srcset", (await Promise.all(srcset.split(",").map(async candidate => {
      const match = candidate.trim().match(/^(\S+)(.*)$/);
      return match ? `${await resolve(match[1]!)}${match[2]}` : candidate;
    }))).join(", "));
  }));
  await Promise.all(Array.from(document.querySelectorAll("style, [style]")).map(async element => {
    if (element.tagName === "STYLE") element.textContent = await embedCssImages(element.textContent ?? "", url => resolve(url));
    if (element.hasAttribute("style")) element.setAttribute("style", await embedCssImages(element.getAttribute("style")!, url => resolve(url)));
  }));
  await Promise.all(Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]')).map(async link => {
    const source = link.getAttribute("href")!;
    if (!isProjectImageUrl(source, documentUrl)) return;
    const css = await resolve(source, documentUrl, true);
    if (css === source) return;
    const style = document.createElement("style");
    if (link.hasAttribute("media")) style.setAttribute("media", link.getAttribute("media")!);
    // Linked stylesheets are one level only; imports never receive host authority.
    style.textContent = (await embedCssImages(css.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi, ""), url => resolve(url, new URL(source, documentUrl).href))).replace(/<\/style/gi, "<\\/style");
    link.replaceWith(style);
  }));
  return fetched.size === 0 ? html : `<!doctype html>${document.documentElement.outerHTML}`;
}
