import path from "node:path";
import type { Browser, BrowserContext, Page } from "../../../backend/node_modules/playwright-core";
import type {} from "../fixtures/logo-construction-browser";
import { appFontResponse } from "./app-font";

const PROJECT = "logo-construction";

/** A two-bowl B drawn for these tests: a stem, two bowls cut by the stem edge, two counters. */
export const LOGO_CONSTRUCTION_RECORD = {
  schema_version: 1,
  grid: 64,
  radii: [{ id: "bowl", value: 10 }, { id: "counter", value: 4 }],
  primitives: [
    { kind: "rect", id: "stem", x: 16, y: 12, width: 8, height: 40 },
    { kind: "line", id: "edge", from: [24, 64], to: [24, 0] },
    { kind: "circle", id: "upper", cx: 32, cy: 22, r: "bowl" },
    { kind: "circle", id: "lower", cx: 32, cy: 42, r: "bowl" },
    { kind: "circle", id: "upper-counter", cx: 32, cy: 22, r: "counter" },
    { kind: "circle", id: "lower-counter", cx: 32, cy: 42, r: "counter" },
  ],
  tree: {
    op: "union",
    args: [
      { ref: "stem" },
      { op: "subtract", args: [{ op: "intersect", args: [{ ref: "upper" }, { ref: "edge" }] }, { ref: "upper-counter" }] },
      { op: "subtract", args: [{ op: "intersect", args: [{ ref: "lower" }, { ref: "edge" }] }, { ref: "lower-counter" }] },
    ],
  },
};

export async function compileLogoConstruction(): Promise<{ script: string; css: string }> {
  const frontend = path.resolve(import.meta.dir, "../..");
  const commands = [
    [process.execPath, "build", `${import.meta.dir}/../fixtures/logo-construction-browser.tsx`, "--target=browser", "--format=iife"],
    [process.execPath, Bun.resolveSync("tailwindcss/lib/cli.js", frontend), "-i", "src/index.css", "-c", "tailwind.config.ts", "--minify"],
  ];
  const outputs: string[] = [];
  for (const command of commands) {
    const child = Bun.spawn(command, { cwd: frontend, stdout: "pipe", stderr: "pipe" });
    const [exit, output, errors] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw new Error(`logo_construction_fixture_compile_failed: ${errors}`);
    outputs.push(output);
  }
  const [script, css] = outputs;
  if (script === undefined || css === undefined) throw new Error("logo_construction_fixture_output_missing");
  return { script, css };
}

export interface LogoConstructionPageOptions {
  readonly script: string;
  readonly css: string;
  readonly width: number;
  readonly dark: boolean;
  readonly reducedMotion: boolean;
  /** The bytes served as `logo-geometry.json`. */
  readonly record: string;
}

export async function withLogoConstruction(
  browser: Browser,
  options: LogoConstructionPageOptions,
  action: (page: Page) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      const font = appFontResponse(pathname);
      if (font) return font;
      if (pathname === "/") return new Response(
        `<!doctype html><html data-theme="${options.dark ? "dark" : "light"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${options.css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
      if (pathname === "/fixture.js") return new Response(options.script, { headers: { "content-type": "text/javascript" } });
      if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "logo-construction-fixture" } });
      if (pathname === `/api/projects/${PROJECT}/files`) {
        return Response.json({ data: [{ rel_path: "logo-geometry.json", category: "document", hash: "fixture" }] });
      }
      if (pathname === `/api/projects/${PROJECT}/fs/logo-geometry.json`) return new Response(options.record);
      return new Response(null, { status: 404 });
    },
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: options.width, height: 900 },
      reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url.href);
    await page.evaluate(() => globalThis.logoConstructionTest.mount("en"));
    await page.evaluate(() => document.fonts.ready);
    await action(page);
    if (errors.length > 0) throw new Error(`logo_construction_browser_errors: ${errors.join("; ")}`);
  } finally {
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}
