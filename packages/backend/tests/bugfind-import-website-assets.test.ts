import { expect, test } from "bun:test";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { extractDesignSystemFromSource } from "../src/services/design-system-extract";

type Route = { readonly body: string; readonly type: string };
type Site = { readonly id: string; readonly origin: string; readonly root: string };
type Outcome = { readonly ok: true; readonly status: string; readonly brand: string } | { readonly ok: false; readonly code: string };

async function withQaWebsite<T>(label: string, routes: Record<string, Route>, run: (site: Site) => Promise<T>): Promise<T> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
    const route = routes[new URL(request.url).pathname];
    return route ? new Response(route.body, { headers: { "content-type": route.type } }) : new Response("missing", { status: 404 });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  const settings = {
    BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: `${origin}/source`,
    BG_EXTRACTION_QA_ADAPTER_STALL_URL: `${origin}/stall`,
    BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: [`${origin}/source`, `${origin}/stall`, ...Object.keys(routes).map((pathname) => `${origin}${pathname}`)].join(","),
    BG_EXTRACTION_QA_ADAPTER_SECRET: "bugfind-import-website-fixture-secret-01",
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const id = `bugfind-import-${label}-${process.pid}`;
  try {
    return await run({ id, origin, root: path.join(systemsDir, id) });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await server.stop(true);
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
}

async function extract(site: Site, name?: string): Promise<Outcome> {
  return extractDesignSystemFromSource({ system_id: site.id, ...(name === undefined ? {} : { name }), source_type: "website", source_url: `${site.origin}/source` }).then(
    (result): Outcome => ({ ok: true, status: result.system.status, brand: result.extraction.brand_name }),
    (error: unknown): Outcome => ({ ok: false, code: error instanceof Error && "code" in error ? String(error.code) : String(error) }),
  );
}

const page = (head: string, body: string) => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

test("IMPORT-1: Given a homepage whose logo is an ordinary SVG with a gradient fill url(#g) When website extraction runs Then the import still publishes a draft", async () => {
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#123456"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>';
  await withQaWebsite("svg-logo", {
    "/source": { type: "text/html", body: page("<title>Acme</title>", '<header><img src="/logo.svg" alt="Acme"></header><h1>Acme</h1>') },
    "/logo.svg": { type: "image/svg+xml", body: logo },
  }, async (site) => {
    expect(await extract(site, "Acme")).toEqual({ ok: true, status: "draft", brand: "Acme" });
  });
});

test("IMPORT-2: Given a homepage with 65 product images and no logo candidates When website extraction runs Then the import still publishes a draft instead of failing on the asset-count limit", async () => {
  const images = Array.from({ length: 65 }, (_, index) => `<img src="/products/item-${index}.png" alt="Item ${index}">`).join("");
  await withQaWebsite("many-images", {
    "/source": { type: "text/html", body: page("<title>Shop</title>", `<h1>Shop</h1><main>${images}</main>`) },
  }, async (site) => {
    expect(await extract(site, "Shop")).toEqual({ ok: true, status: "draft", brand: "Shop" });
  });
});

test("IMPORT-3: Given a site whose title is 'Coca-Cola | Home' and no explicit name When website extraction runs Then the derived brand name keeps the hyphenated brand", async () => {
  await withQaWebsite("hyphen-brand", {
    "/source": { type: "text/html", body: page("<title>Coca-Cola | Home</title>", "<h1>Refresh</h1>") },
  }, async (site) => {
    expect(await extract(site)).toEqual({ ok: true, status: "draft", brand: "Coca-Cola" });
  });
});

test("IMPORT-4: Given twelve extracted pages in discovery order When the draft is published Then the eight UI-kit pages are the first eight in discovery order, not a lexical page-10 before page-2 selection", async () => {
  const sections = Array.from({ length: 11 }, (_, index) => `/section${index + 1}`);
  const routes: Record<string, Route> = {
    "/source": { type: "text/html", body: page("<title>Multi</title>", `<nav>${sections.map((href) => `<a href="${href}">${href}</a>`).join("")}</nav><h1>Home</h1>`) },
  };
  for (const href of sections) routes[href] = { type: "text/html", body: page(`<title>${href}</title>`, `<h1>${href}</h1>`) };
  await withQaWebsite("ui-kit-order", routes, async (site) => {
    expect(await extract(site, "Multi")).toEqual({ ok: true, status: "draft", brand: "Multi" });
    const published = (await readdir(path.join(site.root, "ui_kits", "website"))).filter((name) => name.endsWith(".html")).sort();
    expect(published).toEqual(["index.html", "page-2.html", "page-3.html", "page-4.html", "page-5.html", "page-6.html", "page-7.html", "page-8.html"]);
  });
});
