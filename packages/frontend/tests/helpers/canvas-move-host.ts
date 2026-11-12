import path from "node:path";
import type { Browser, BrowserContext, Page } from "../../../backend/node_modules/playwright-core";
import { applyHtmlNodePatch, htmlWithEditableIds } from "../../../backend/src/services/file-patch";
import type {} from "../fixtures/canvas-move-browser";
import { appFontResponse } from "./app-font";

export async function compileCanvasMove(): Promise<{ script: string; css: string }> {
  const frontend = path.resolve(import.meta.dir, "../..");
  const commands = [
    [process.execPath, "build", `${import.meta.dir}/../fixtures/canvas-move-browser.tsx`, "--target=browser", "--format=iife"],
    [process.execPath, Bun.resolveSync("tailwindcss/lib/cli.js", frontend), "-i", "src/index.css", "-c", "tailwind.config.ts", "--minify"],
  ];
  const outputs: string[] = [];
  for (const command of commands) {
    const child = Bun.spawn(command, { cwd: frontend, stdout: "pipe", stderr: "pipe" });
    const [exit, output, errors] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw new Error(`canvas_move_fixture_compile_failed: ${errors}`);
    outputs.push(output);
  }
  const [script, css] = outputs;
  if (script === undefined || css === undefined) throw new Error("canvas_move_fixture_output_missing");
  return { script, css };
}

/**
 * Serves the Style overlay over one authored page from `fixtures/canvas-move/` and runs `action` on it. The page is
 * kept the way the app keeps a file: the canvas reads it with editable ids, and a save rewrites it with the backend's
 * own patch function, so what the test measures afterwards is the saved file as the browser renders it.
 */
export async function withCanvasMove(
  browser: Browser,
  options: { readonly script: string; readonly css: string; readonly document: string; readonly width: number; readonly zoom?: number },
  action: (page: Page) => Promise<void>,
): Promise<void> {
  let source = await Bun.file(path.resolve(import.meta.dir, "../fixtures/canvas-move", options.document)).text();
  const html = { headers: { "content-type": "text/html; charset=utf-8" } };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const font = appFontResponse(pathname);
      if (font) return font;
      if (pathname === "/") return new Response(
        `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${options.css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
        html,
      );
      if (pathname === "/fixture.js") return new Response(options.script, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      if (pathname === "/document") return new Response(htmlWithEditableIds(source), html);
      if (pathname === "/save" && request.method === "POST") {
        source = applyHtmlNodePatch(source, await request.json());
        return new Response(htmlWithEditableIds(source), html);
      }
      return new Response(null, { status: 404 });
    },
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: options.width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url.href);
    await page.evaluate(zoom => globalThis.canvasMoveTest.mount(zoom), options.zoom ?? 1);
    await action(page);
    if (errors.length > 0) throw new Error(`canvas_move_browser_errors: ${errors.join("; ")}`);
  } finally {
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}
