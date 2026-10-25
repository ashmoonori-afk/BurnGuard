import path from "node:path";
import type { Browser, BrowserContext, Page } from "../../../backend/node_modules/playwright-core";
import type {} from "../fixtures/workspace-controls-browser";
import { appFontResponse } from "./app-font";

type ExportObservationPhase = "close-arm" | "state-mutation" | "close-deadline";
declare global {
  var workspaceExportObservation: (phase: ExportObservationPhase, boundary: boolean, observed: Element, oldState?: string | null) => void;
}

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
  const observations: string[] = [];
  try {
    context = await browser.newContext({ viewport: { width: assets.width, height: 900 } });
    await context.addInitScript(() => {
      if (window !== window.top) return;
      let sequence = 0;
      let count = 0;
      const state = (element: Element | null) => {
        if (!element) return "missing";
        const value = element.getAttribute("data-state");
        return value === "open" || value === "closed" ? value : "other";
      };
      const classify = (target: EventTarget | null) => {
        if (!(target instanceof Element)) return "other";
        if (target.closest('[aria-haspopup="menu"]')) return "trigger";
        if (target.closest("[data-export-menu-content]")) return "menu";
        if (target.closest('[role="dialog"]')) return "dialog";
        return target.closest("[data-outside-target]") ? "outside" : "other";
      };
      const record = (phase: string, event: Event | null, boundary?: boolean, observed?: Element, oldState?: string | null) => {
        if (count >= 64) return;
        count += 1;
        console.info(`QA_EXPORT_CLOSE ${JSON.stringify({
          phase, sequence, ms: Math.round(performance.timeOrigin + performance.now()),
          menuCount: document.querySelectorAll("[data-export-menu-content]").length,
          menuState: state(document.querySelector("[data-export-menu-content]")),
          active: classify(document.activeElement), target: classify(event?.target ?? null),
          focused: document.hasFocus(), trusted: event?.isTrusted ?? false, prevented: event?.defaultPrevented ?? false,
          boundary: boundary ?? null, observedState: observed ? state(observed) : "none",
          observedConnected: observed?.isConnected ?? null,
          oldState: oldState === "open" || oldState === "closed" ? oldState : "other",
        })}`);
      };
      globalThis.workspaceExportObservation = (phase, boundary, observed, oldState) => {
        if (phase === "close-arm") sequence += 1;
        record(phase, null, boundary, observed, oldState);
      };
      for (const type of ["pointerdown", "pointerup", "focusin", "focusout"] as const) {
        window.addEventListener(type, event => record(type, event), true);
      }
      window.addEventListener("keydown", event => {
        if (event.key === "Escape") record("escape-capture", event);
      }, true);
      window.addEventListener("keydown", event => {
        if (event.key === "Escape") record("escape-bubble", event);
      });
    });
    const page = await context.newPage();
    page.on("console", message => {
      const text = message.text();
      if (text.startsWith("QA_EXPORT_CLOSE ") && observations.length < 64) observations.push(text.slice("QA_EXPORT_CLOSE ".length, "QA_EXPORT_CLOSE ".length + 1024));
    });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url.href);
    await page.evaluate(() => globalThis.workspaceControlsTest.mount("en"));
    await page.evaluate(() => document.fonts.ready);
    await action(page, mutations);
    if (errors.length > 0) throw new Error(`workspace_browser_errors: ${errors.join("; ")}`);
  } finally {
    console.error(JSON.stringify({ event: "export_close_trace", width: assets.width, browser: browser.version(), records: observations, truncated: observations.length === 64 }));
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}
