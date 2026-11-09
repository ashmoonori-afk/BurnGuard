import path from "node:path";
import type { Browser, BrowserContext, Page } from "../../../backend/node_modules/playwright-core";
import type { ExportAttempt, ExportJob } from "@bg/shared";
import type {} from "../fixtures/export-construction-browser";
import { appFontResponse } from "./app-font";

const PROJECT = "export-construction";

export async function compileExportConstruction(): Promise<{ script: string; css: string }> {
  const frontend = path.resolve(import.meta.dir, "../..");
  const commands = [
    [process.execPath, "build", `${import.meta.dir}/../fixtures/export-construction-browser.tsx`, "--target=browser", "--format=iife"],
    [process.execPath, Bun.resolveSync("tailwindcss/lib/cli.js", frontend), "-i", "src/index.css", "-c", "tailwind.config.ts", "--minify"],
  ];
  const outputs: string[] = [];
  for (const command of commands) {
    const child = Bun.spawn(command, { cwd: frontend, stdout: "pipe", stderr: "pipe" });
    const [exit, output, errors] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw new Error(`export_construction_fixture_compile_failed: ${errors}`);
    outputs.push(output);
  }
  const [script, css] = outputs;
  if (script === undefined || css === undefined) throw new Error("export_construction_fixture_output_missing");
  return { script, css };
}

function constructionJob(status: "running" | "failed"): ExportJob {
  const attempt: ExportAttempt = {
    id: "attempt", job_id: "job", parent_attempt_id: null, status,
    project_revision: 1, project_digest: "a".repeat(64),
    digests: { options: "options", input_closure: null, design_system: null, renderer: "renderer", capture: null, output: null, receipt: null },
    progress: { stage: "rendering", completed: 2, total: 6 },
    stop_reason: status === "failed" ? "render_failed" : null, findings: [],
    retention: { retained_until: 1000, output_available: false }, cancel_requested_at: null, created_at: 1, updated_at: 1,
  };
  return {
    id: "job", project_id: PROJECT, format: "construction_gif", status, output_path: null,
    error_message: status === "failed" ? "Export failed: construction_too_large" : null,
    size_bytes: null, options: {}, latest_attempt: attempt, handoff_continuation: null,
    created_at: 1, completed_at: status === "failed" ? 2 : null,
  };
}

export interface ExportConstructionPageOptions {
  readonly script: string;
  readonly css: string;
  readonly width: number;
  readonly dark: boolean;
  /** Whether the project file listing holds `logo-geometry.json`. */
  readonly constructionRecord: boolean;
  /** Serve one running draw-in GIF export that fails as too large on its next poll. */
  readonly failingGif: boolean;
  readonly locale?: "ko" | "en" | "zh-CN";
}

export async function withExportConstruction(
  browser: Browser,
  options: ExportConstructionPageOptions,
  action: (page: Page) => Promise<void>,
): Promise<void> {
  let exportPolls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      const font = appFontResponse(pathname);
      if (font) return font;
      if (pathname === "/") return new Response(
        `<!doctype html><html data-theme="${options.dark ? "dark" : "light"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${options.css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
      if (pathname === "/fixture.js") return new Response(options.script, { headers: { "content-type": "text/javascript" } });
      if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "export-construction-fixture" } });
      if (pathname === `/api/projects/${PROJECT}/files`) {
        return Response.json({ data: options.constructionRecord ? [{ rel_path: "logo-geometry.json", category: "document", hash: "fixture" }] : [] });
      }
      if (pathname === `/api/projects/${PROJECT}/exports`) {
        if (!options.failingGif) return Response.json({ data: [] });
        exportPolls += 1;
        return Response.json({ data: [constructionJob(exportPolls === 1 ? "running" : "failed")] });
      }
      return new Response(null, { status: 404 });
    },
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: options.width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url.href);
    await page.evaluate(locale => globalThis.exportConstructionTest.mount(locale), options.locale ?? "en");
    await page.evaluate(() => document.fonts.ready);
    await action(page);
    if (errors.length > 0) throw new Error(`export_construction_browser_errors: ${errors.join("; ")}`);
  } finally {
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}
