import { existsSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { APP_NAME } from "@bg/shared/app";
import { APP_SHELL_SECURITY_HEADERS } from "@bg/shared/security";
import { resolveRepoRoot } from "./lib/paths";
import {
  createRequestAuthority,
  type RequestAuthorityOptions,
} from "./security/request-authority";
import { PathBoundaryError, resolveWithin } from "./security/path-boundary";
import { createRequestBodyLimit } from "./security/request-limits";

export function createApp(authority?: RequestAuthorityOptions): Hono {
  const app = new Hono();
  if (authority) {
    app.use("/api/*", createRequestAuthority(authority));
  }
  // Body ceilings run before any route parses a body; the authority check
  // above already refused unauthenticated callers without touching it.
  app.use("/api/*", createRequestBodyLimit());

  // Generated decks use this stable public, bundled runtime URL.
  app.get("/runtime/deck-stage.js", async (c) => (await import("./routes/runtime")).runtimeRoutes.fetch(c.req.raw));

  app.all("/api/*", async (c) => apiRoutes(classifyApiRoute(c.req.path, c.req.method)).then((routes) => routes.fetch(c.req.raw)));

  app.get("/assets/*", async (c) => {
    const distDir = findFrontendDistDir();
    // Hono 4.x does not expose the wildcard match via c.req.param("*") for a
    // bare `/*` pattern — extract manually from the path.
    const prefix = "/assets/";
    const rawPath = new URL(c.req.url).pathname;
    const assetPath = rawPath.startsWith(prefix)
      ? decodeURIComponent(rawPath.slice(prefix.length))
      : "";
    if (!distDir || !assetPath) {
      return c.notFound();
    }

    try {
      const assetsDir = resolveWithin(distDir, "assets");
      const absolutePath = resolveWithin(assetsDir, assetPath);
      if (!existsSync(absolutePath)) {
        return c.notFound();
      }
      return new Response(Bun.file(absolutePath));
    } catch (error) {
      if (error instanceof PathBoundaryError) return c.notFound();
      throw error;
    }
  });

  app.get("*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/")) {
      return c.notFound();
    }

    const distDir = findFrontendDistDir();
    if (distDir) {
      const indexPath = path.join(distDir, "index.html");
      if (existsSync(indexPath)) {
        return new Response(Bun.file(indexPath), {
          headers: {
            ...APP_SHELL_SECURITY_HEADERS,
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }
    }

    for (const [name, value] of Object.entries(APP_SHELL_SECURITY_HEADERS)) c.header(name, value);
    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${APP_NAME} - Phase 0</title>
  <style>
    :root { color-scheme: light; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #FAFAF7;
      color: #1C2B36;
      display: grid;
      place-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 24px;
    }
    .card {
      background: #FFFFFF;
      padding: 48px;
      border-radius: 12px;
      border: 1px solid #E8E3DB;
      box-shadow: 0 6px 16px rgba(28, 43, 54, 0.10);
      max-width: 480px;
      width: 100%;
    }
    h1 { margin: 0 0 8px; font-size: 28px; font-weight: 600; }
    .sub { color: #5B7282; margin: 0 0 24px; }
    .kv {
      background: #F2F5F7;
      border-radius: 8px;
      padding: 16px;
      font-family: "SF Mono", Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .foot { margin-top: 24px; font-size: 12px; color: #9FB1BD; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${APP_NAME}</h1>
    <p class="sub">Frontend dist not found yet. Build the Vite app to replace this placeholder.</p>
    <div class="kv" id="kv">loading /api/health...</div>
    <p class="foot">Phase 1 serves the React app from <code>packages/frontend/dist</code>.</p>
  </div>
  <script>
    fetch("/api/health")
      .then(r => r.json())
      .then(h => {
        document.getElementById("kv").innerHTML =
          "version: " + h.version + "<br>" +
          "runtime: " + h.runtime + "<br>" +
          "platform: " + h.platform + "<br>" +
          "uptime: " + h.uptimeMs + "ms";
      })
      .catch(e => {
        document.getElementById("kv").textContent = "health error: " + e;
      });
  </script>
</body>
</html>`);
  });

  return app;
}

export type ApiRouteDomain = "three-scene" | "health" | "research" | "catalog" | "learning" | "system" | "managed-files" | "artifact-operations" | "artifacts" | "comments" | "session" | "runtime" | "settings" | "home" | "project" | "not-found";

export function classifyApiRoute(pathname: string, method: string): ApiRouteDomain {
  if (pathname === "/api/health") return "health";
  if (pathname.startsWith("/api/research")) return "research";
  if (pathname.startsWith("/api/learning")) return "learning";
  if (pathname.startsWith("/api/design-systems")) {
    if (/^\/api\/design-systems\/[^/]+\/files\//.test(pathname)) return "catalog";
    return /\/(?:extract|upload|tokens|colors|fonts|pinterest)(?:\/|$)/.test(pathname) ? "system" : "catalog";
  }
  if (/^\/api\/exports\/[^/]+\/download$/.test(pathname)) return "managed-files";
  if (pathname.startsWith("/api/exports")) return "artifacts";
  if (pathname.startsWith("/api/comments") || /\/comments(?:\/|$)/.test(pathname)) return "comments";
  if (pathname.startsWith("/api/sessions")) return "session";
  if (pathname.startsWith("/api/runtime")) return "runtime";
  if (pathname.startsWith("/api/settings/")) return "settings";
  if (pathname === "/api/settings" || pathname.startsWith("/api/backends") || pathname.startsWith("/api/home") || pathname === "/api/projects") return "home";
  if (method === "GET" && /^\/api\/projects\/[^/]+\/thumbnail$/.test(pathname)) return "home";
  if (/^\/api\/projects\/[^/]+\/three-scene$/.test(pathname)) return "three-scene";
  if (pathname.startsWith("/api/projects")) {
    if (/\/checkpoints(?:\/|$)/.test(pathname)) return "session";
    if (/\/draws(?:\/|$)/.test(pathname) && (method === "GET" || method === "PUT")) return "managed-files";
    if (/\/fs(?:\/|$)/.test(pathname) && method === "GET" && !pathname.endsWith("/undo-info")) return "managed-files";
    if (/\/(?:fs|operations)(?:\/|$)/.test(pathname)) return "artifact-operations";
    if (/\/(?:files|artifacts|refresh|exports|design-audit|ux-review)(?:\/|$)/.test(pathname)) return "artifacts";
    return "project";
  }
  return "not-found";
}

async function apiRoutes(domain: ApiRouteDomain): Promise<Hono> {
  switch (domain) {
    case "three-scene": return (await import("./routes/three-scene")).threeSceneRoutes;
    case "health": return (await import("./routes/health")).healthRoutes;
    case "research": return (await import("./routes/research")).researchRoutes;
    case "catalog": return (await import("./routes/catalog")).catalogRoutes;
    case "learning": return (await import("./routes/learning")).learningRoutes;
    case "system": return (await import("./routes/system")).systemRoutes;
    case "managed-files": return (await import("./routes/managed-files")).managedFileRoutes;
    case "artifact-operations": return (await import("./routes/artifact-operations")).artifactOperationRoutes;
    case "artifacts": return (await import("./routes/artifacts")).artifactRoutes;
    case "comments": return (await import("./routes/comments")).commentRoutes;
    case "session": return (await import("./routes/session")).sessionRoutes;
    case "runtime": return (await import("./routes/runtime")).runtimeRoutes;
    case "settings": return (await import("./routes/settings")).settingsRoutes;
    case "home": return (await import("./routes/home")).homeRoutes;
    case "project": return (await import("./routes/project")).projectRoutes;
    case "not-found": return new Hono();
  }
}

function findFrontendDistDir() {
  const repoRoot = resolveRepoRoot();
  const candidates = [
    path.join(repoRoot, "packages", "frontend", "dist"),
    path.join(import.meta.dir, "..", "..", "frontend", "dist"),
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? null;
}
