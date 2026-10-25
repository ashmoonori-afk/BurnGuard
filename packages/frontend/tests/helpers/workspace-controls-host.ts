import path from "node:path";
import type { Browser, BrowserContext, Page } from "../../../backend/node_modules/playwright-core";
import type {} from "../fixtures/workspace-controls-browser";
import { appFontResponse } from "./app-font";

export async function compileWorkspaceControls(): Promise<{ script: string; css: string }> {
  const frontend = path.resolve(import.meta.dir, "../..");
  const commands = [
    [process.execPath, "build", `${import.meta.dir}/../fixtures/workspace-controls-browser.tsx`, "--target=browser", "--format=iife"],
    [process.execPath, Bun.resolveSync("tailwindcss/lib/cli.js", frontend), "-i", "src/index.css", "-c", "tailwind.config.ts", "--minify"],
  ];
  const outputs: string[] = [];
  for (const command of commands) {
    const child = Bun.spawn(command, { cwd: frontend, stdout: "pipe", stderr: "pipe" });
    const [exit, output, errors] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw new Error(`workspace_fixture_compile_failed: ${errors}`);
    outputs.push(output);
  }
  const [script, css] = outputs;
  if (script === undefined || css === undefined) throw new Error("workspace_fixture_output_missing");
  return { script, css };
}

export async function withWorkspaceControls(
  browser: Browser,
  assets: { readonly script: string; readonly css: string; readonly width: number; readonly dark?: boolean },
  action: (page: Page, mutations: string[]) => Promise<void>,
): Promise<void> {
  const mutations: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      const font = appFontResponse(pathname);
      if (font) return font;
      if (request.method !== "GET") mutations.push(`${request.method} ${pathname}`);
      if (pathname === "/") return new Response(
        `<!doctype html><html data-theme="${assets.dark ? "dark" : "light"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${assets.css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
      if (pathname === "/fixture.js") return new Response(assets.script, { headers: { "content-type": "text/javascript" } });
      if (pathname === "/assets/burnguard-mark.png") return new Response(Bun.file(path.resolve(import.meta.dir, "../../public/assets/burnguard-mark.png")));
      if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "workspace-fixture" } });
      if (pathname === "/api/projects/workspace-controls/exports") return Response.json({ data: [] });
      if (pathname === "/api/projects/workspace-controls/instructions") return Response.json({ data: { text: null } });
      return new Response(null, { status: 404 });
    },
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: assets.width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url.href);
    await page.evaluate(() => globalThis.workspaceControlsTest.mount("en"));
    await page.evaluate(() => document.fonts.ready);
    await action(page, mutations);
    if (errors.length > 0) throw new Error(`workspace_browser_errors: ${errors.join("; ")}`);
  } finally {
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}
