import { authorizedFetch } from "@/api/client";

export function isProjectImageUrl(value: string, documentUrl: string): boolean {
  if (value.startsWith("#")) return false;
  try {
    const document = new URL(documentUrl);
    const root = document.pathname.match(/^\/api\/projects\/[^/]+\/(?:preview\/[^/]+\/)?fs\//)?.[0];
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

/** Embed project resources: opaque frames cannot send Strict cookies. */
export async function embedCanvasImages(html: string, documentUrl: string, signal: AbortSignal): Promise<string> {
  const document = new DOMParser().parseFromString(html, "text/html");
  const fetched = new Map<string, Promise<string>>();
  const resources = new AbortController();
  const boundedSignal = AbortSignal.any([signal, resources.signal, AbortSignal.timeout(15000)]);
  const budget = { remaining: 32 * 1024 * 1024 };
  const resolve = async (source: string, base = documentUrl, kind: "asset" | "css" | "script" = "asset"): Promise<string> => {
    if (!source || !isProjectImageUrl(source, base)) return source;
    const target = new URL(source, base);
    if (kind !== "asset") target.hash = "";
    const url = target.href;
    const key = `${kind}:${url}`;
    let pending = fetched.get(key);
    if (!pending) {
      if (fetched.size >= 64) { resources.abort(); throw new Error("artifact_image_limit"); }
      pending = (async () => {
        const response = await authorizedFetch(url, { signal: boundedSignal, redirect: "error" });
        if (!response.ok) throw Object.assign(new Error("artifact_image_load_failed"), { httpStatus: response.status });
        const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        const validMime = kind === "script" ? /^(?:text|application)\/(?:javascript|ecmascript)$/.test(mime)
          : kind === "css" ? mime === "text/css"
          : /^(?:image\/|font\/(?:woff2?|ttf|otf)$|application\/(?:font-woff|vnd.ms-fontobject)$)/.test(mime);
        if (!validMime) {
          await response.body?.cancel();
          if (kind === "script") throw new Error("artifact_script_mime_invalid");
          return source;
        }
        const blob = await readCanvasImage(response, budget, () => resources.abort());
        if (kind !== "asset") return blob.text();
        return new Promise<string>((done, reject) => {
          const reader = new FileReader();
          reader.onload = () => done(String(reader.result));
          reader.onerror = () => reject(new Error("artifact_image_read_failed"));
          reader.readAsDataURL(blob);
        });
      })().catch((error: unknown) => {
        // A draft may reference an image/CSS file that the generator writes next.
        if (/\/preview\//.test(new URL(documentUrl).pathname) && error !== null && typeof error === "object" && "httpStatus" in error && error.httpStatus === 404) return source;
        resources.abort(); throw error;
      });
      fetched.set(key, pending);
    }
    return pending;
  };
  let stylesheetCount = 0;
  const embedStylesheet = async (css: string, base: string, ancestors: readonly string[]): Promise<string> => {
    boundedSignal.throwIfAborted();
    // Parse in an inert document: the browser handles escaped URLs, comments,
    // import ordering and conditional syntax without issuing resource requests.
    const parser = document.implementation.createHTMLDocument("");
    const style = parser.createElement("style");
    style.textContent = css;
    parser.head.append(style);
    if (!style.sheet) throw new Error("artifact_stylesheet_parse_failed");
    const rules = Array.from(style.sheet.cssRules);
    if (!rules.some(rule => rule.type === CSSRule.IMPORT_RULE)) return embedCssImages(css, url => resolve(url, base));
    return (await Promise.all(rules.map(async rule => {
      if (!(rule instanceof CSSImportRule)) return embedCssImages(rule.cssText, url => resolve(url, base));
      const imported = rule;
      if (!isProjectImageUrl(imported.href, base)) return "";
      const target = new URL(imported.href, base);
      target.hash = "";
      const url = target.href;
      if (ancestors.includes(url)) return "";
      // Bound expansion too: repeated imports can otherwise grow exponentially
      // without consuming additional entries in the fetch cache.
      if (++stylesheetCount > 64) { resources.abort(); throw new Error("artifact_image_limit"); }
      const source = await resolve(url, base, "css");
      if (source === url) return "";
      let content = await embedStylesheet(source, url, [...ancestors, url]);
      // Data/blob stylesheet imports are forbidden by the artifact CSP. Inline
      // rules instead, retaining import conditions and cascade layer boundaries.
      if (imported.media.mediaText) content = `@media ${imported.media.mediaText}{${content}}`;
      if (imported.supportsText !== null) content = `@supports (${imported.supportsText}){${content}}`;
      if (imported.layerName !== null) content = `@layer ${imported.layerName}{${content}}`;
      return content;
    }))).join("\n");
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
    if (element.tagName === "STYLE") element.textContent = (await embedStylesheet(element.textContent ?? "", documentUrl, [])).replace(/<\/style/gi, "<\\/style");
    if (element.hasAttribute("style")) element.setAttribute("style", await embedCssImages(element.getAttribute("style")!, url => resolve(url)));
  }));
  await Promise.all(Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]')).map(async link => {
    const source = link.getAttribute("href")!;
    if (!isProjectImageUrl(source, documentUrl)) return;
    const css = await resolve(source, documentUrl, "css");
    if (css === source) return;
    const style = document.createElement("style");
    if (link.hasAttribute("media")) style.setAttribute("media", link.getAttribute("media")!);
    const target = new URL(source, documentUrl);
    target.hash = "";
    style.textContent = (await embedStylesheet(css, target.href, [target.href])).replace(/<\/style/gi, "<\\/style");
    link.replaceWith(style);
  }));
  await Promise.all(Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map(async script => {
    const source = script.getAttribute("src") ?? "";
    const type = (script.getAttribute("type") ?? "").trim().toLowerCase();
    if (type && type !== "module" && !/^(?:text|application)\/(?:javascript|ecmascript)$/.test(type)) return;
    if (!isProjectImageUrl(source, documentUrl)) return;
    const code = await resolve(source, documentUrl, "script");
    if (code === source) return; // A preview may not have written this file yet.
    const marker = `bg-script-${crypto.randomUUID()}`;
    script.setAttribute("src", marker);
    const tag = script.outerHTML;
    const bootstrap = document.createElement("script");
    const json = (value: string) => JSON.stringify(value).replaceAll("<", "\\u003c");
    // Create URLs in the opaque document, not the parent. document.write keeps
    // scripts parser-inserted: blocking scripts, inline siblings, defer, async,
    // attributes and load handlers retain browser semantics. No eval of code.
    // Relative module imports/currentScript.src-based assets are not rewritten;
    // document.baseURI remains the original resource base.
    bootstrap.textContent = `(function(){
      var url=URL.createObjectURL(new Blob([${json(code)}],{type:"text/javascript"}));
      function release(event){
        if(event.target.src!==url)return;
        URL.revokeObjectURL(url);
        document.removeEventListener("load",release,true);
        document.removeEventListener("error",release,true);
      }
      document.addEventListener("load",release,true);
      document.addEventListener("error",release,true);
      document.write(${json(tag)}.replace(${json(marker)},url));
    })();`;
    script.replaceWith(bootstrap);
  }));
  boundedSignal.throwIfAborted();
  return fetched.size === 0 ? html : `<!doctype html>${document.documentElement.outerHTML}`;
}
