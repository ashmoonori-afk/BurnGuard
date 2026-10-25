import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import type {} from "./fixtures/northvale-previews-browser";

const pages = ["colors-neutrals.html", "colors-ramps.html", "colors-charts.html", "brand-icons.html"] as const;
const hues = ["red", "orange", "yellow", "green", "teal", "aqua", "blue", "ultramarine", "purple", "pink"] as const;
const prefix = "/api/design-systems/northvale-capital/files/";
const source = path.resolve(import.meta.dir, "../../../design system sample");
const assets = new Map<string, Uint8Array>();
const palette = new Map<string, string>();
let browser: Browser | undefined;
let script = "";
let css = "";
const lifetime = new AbortController();

async function compile(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`northvale_fixture_compile_failed: ${errors}`);
  return output;
}

beforeAll(async () => {
  const frontend = path.resolve(import.meta.dir, "..");
  [script, css] = await Promise.all([
    compile([process.execPath, "build", `${import.meta.dir}/fixtures/northvale-previews-browser.tsx`, "--target=browser", "--format=iife"], frontend),
    compile([process.execPath, Bun.resolveSync("tailwindcss/lib/cli.js", frontend), "-i", "src/index.css", "-c", "tailwind.config.ts", "--minify"], frontend),
  ]);
  for (const relative of ["colors_and_type.css", ...pages.map(name => `preview/${name}`), ...(await readdir(path.join(source, "fonts"))).map(name => `fonts/${name}`)]) {
    assets.set(relative, await readFile(path.join(source, relative)));
  }
  const tokens = await readFile(path.join(source, "colors_and_type.css"), "utf8");
  for (const match of tokens.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)) {
    const [, name, value] = match;
    if (name && value) palette.set(name, rgb(value));
  }
  browser = await launchChromiumViaNode({}, lifetime.signal);
});

afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

function rgb(hex: string): string {
  return `rgb(${[1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
}

type Fixture = { readonly page: Page; readonly external: readonly string[]; readonly requests: readonly string[] };
async function withPreview(
  options: { readonly width: number; readonly dark: boolean; readonly overrides?: string; readonly probe?: boolean },
  action: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  if (!browser) throw new Error("northvale_browser_missing");
  const requests: string[] = [];
  const external: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      requests.push(`${request.method} ${pathname}`);
      if (pathname === "/") return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>`, { headers: { "content-type": "text/html" } });
      if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "northvale-fixture" } });
      const relative = pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length)) : "";
      const bytes = assets.get(relative);
      if (!bytes) return new Response(null, { status: 404 });
      let body: ArrayBuffer | string = new Uint8Array(bytes).buffer;
      if (relative === "colors_and_type.css" && options.overrides) body = `${new TextDecoder().decode(bytes)}\n:root { ${options.overrides} }\n`;
      if (relative === "preview/brand-icons.html" && options.probe) body = `${new TextDecoder().decode(bytes)}<script>document.body.dataset.executed="yes";</script>`;
      const type = relative.endsWith(".html") ? "text/html" : relative.endsWith(".css") ? "text/css" : "application/octet-stream";
      return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": type } });
    },
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: options.width, height: 900 }, colorScheme: options.dark ? "dark" : "light" });
    await context.route("**/*", async route => {
      if (new URL(route.request().url()).origin !== server.url.origin) {
        external.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(server.url.origin);
    await page.addScriptTag({ content: script });
    await page.evaluate(dark => globalThis.northvalePreviewTest.mount(dark), options.dark);
    await action({ page, external, requests });
  } finally {
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}

async function measure(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("iframe")].map(frame => {
    const child = frame.contentDocument;
    if (!child) throw new Error("northvale_child_missing");
    const view = child.defaultView;
    if (!view) throw new Error("northvale_child_window_missing");
    return {
      name: frame.title, sandbox: frame.getAttribute("sandbox"), scripts: child.scripts.length,
      overflow: child.documentElement.scrollWidth > child.documentElement.clientWidth,
      ramps: [...child.querySelectorAll(".ramp")].map(ramp => ramp.querySelectorAll(".sw").length),
      bars: child.querySelectorAll(".bar").length, legends: child.querySelectorAll(".lg").length,
      swatches: [...child.querySelectorAll<HTMLElement>("[data-token]")].map(element => {
        const bounds = element.getBoundingClientRect();
        return { token: element.dataset.token, color: view.getComputedStyle(element).backgroundColor, width: bounds.width, height: bounds.height };
      }),
      icons: [...child.querySelectorAll<SVGSVGElement>(".ic svg")].map(icon => {
        const bounds = icon.getBoundingClientRect();
        const drawing = icon.getBBox();
        return {
          viewBox: icon.getAttribute("viewBox"), stroke: view.getComputedStyle(icon).strokeWidth,
          width: bounds.width, height: bounds.height, drawingWidth: drawing.width, drawingHeight: drawing.height,
          shapes: icon.querySelectorAll("path,polyline,polygon,line,circle,rect").length,
          external: icon.querySelectorAll("use,image,script,foreignObject").length,
        };
      }),
    };
  }));
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    test(`Given the actual preview component at ${width}px in ${dark ? "dark" : "light"} chrome When its scriptless frames load Then all four local previews render`, async () => {
      await withPreview({ width, dark }, async f => {
        const result = await measure(f.page);
        expect(result.map(page => page.name)).toEqual([...pages]);
        for (const page of result) {
          expect(page.sandbox).toBe("allow-same-origin");
          expect(page.scripts).toBe(0);
          expect(page.overflow).toBe(false);
          for (const swatch of page.swatches) {
            expect(swatch.width).toBeGreaterThan(0);
            expect(swatch.height).toBeGreaterThan(0);
            const expected = palette.get(swatch.token ?? "");
            if (expected === undefined) throw new Error("northvale_token_missing");
            expect(swatch.color).toBe(expected);
          }
        }
        const [neutrals, ramps, charts, icons] = result;
        expect(neutrals?.swatches.map(swatch => swatch.token)).toEqual(Array.from({ length: 10 }, (_, i) => `gray-${(i + 1) * 10}`));
        expect(ramps?.ramps).toEqual(Array.from({ length: 10 }, () => 10));
        expect(ramps?.swatches.map(swatch => swatch.token)).toEqual(hues.flatMap(hue => Array.from({ length: 10 }, (_, i) => `${hue}-${(i + 1) * 10}`)));
        expect(charts?.bars).toBe(10);
        expect(charts?.legends).toBe(10);
        expect(charts?.swatches.map(swatch => swatch.token)).toEqual([...Array.from({ length: 10 }, (_, i) => `chart-${i + 1}`), ...Array.from({ length: 10 }, (_, i) => `chart-${i + 1}`)]);
        expect(icons?.icons).toHaveLength(16);
        for (const icon of icons?.icons ?? []) {
          expect(icon.viewBox).toBe("0 0 24 24");
          expect(icon.stroke).toBe("1.5px");
          expect(Math.min(icon.width, icon.height, icon.drawingWidth, icon.drawingHeight, icon.shapes)).toBeGreaterThan(0);
          expect(icon.external).toBe(0);
        }
        expect(f.external).toEqual([]);
        for (const name of pages) expect(f.requests).toContain(`HEAD ${prefix}preview/${name}`);
      });
    });
  }
}

test("Given changed token authority When previews load Then neutrals ramps bars and legends follow the changed tokens", async () => {
  await withPreview({ width: 390, dark: false, overrides: "--gray-10:#010203;--red-20:#040506;--chart-1:#070809;" }, async f => {
    const result = await measure(f.page);
    const swatches = result.flatMap(page => page.swatches);
    for (const [token, color, count] of [["gray-10", "rgb(1, 2, 3)", 1], ["red-20", "rgb(4, 5, 6)", 1], ["chart-1", "rgb(7, 8, 9)", 2]] as const) {
      expect(swatches.filter(swatch => swatch.token === token).map(swatch => swatch.color)).toEqual(Array.from({ length: count }, () => color));
    }
    expect(f.external).toEqual([]);
  });
});

test("Given an authored script in a preview When the actual component loads it Then its sandbox prevents script execution", async () => {
  await withPreview({ width: 390, dark: false, probe: true }, async f => {
    expect(await f.page.evaluate(() => document.querySelector<HTMLIFrameElement>('iframe[title="brand-icons.html"]')?.contentDocument?.body.dataset.executed)).toBeUndefined();
    expect((await measure(f.page)).find(page => page.name === "brand-icons.html")?.scripts).toBe(1);
    expect(f.external).toEqual([]);
  });
});
