import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WEB_ASSET_CREDITS_FILE, WEB_ASSET_TOOL_NAMES } from "@bg/shared";
import { importWebAsset, searchWebAssets, WebAssetError, type WebAssetFetch } from "../src/services/web-assets";
import { handleWebAssetsMcpMessage } from "../src/services/web-assets-mcp";

const UUID = "13b0ec75-08a2-4b4a-865d-f2fe98a1c43d";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>';

const openverseItem = (overrides: Record<string, unknown> = {}) => ({
  id: UUID, title: "Mountain lake", foreign_landing_url: "https://www.flickr.com/photos/x/1", creator: "Ann",
  license: "by", license_version: "2.0", license_url: "https://creativecommons.org/licenses/by/2.0/", category: "photograph", ...overrides,
});
const collections = {
  ph: { name: "Phosphor", author: { name: "Phosphor Icons" }, license: { spdx: "MIT", url: "https://github.com/phosphor-icons/core/blob/main/LICENSE" } },
  gpl: { name: "Copyleft set", license: { spdx: "GPL-3.0" } },
};

interface Call { readonly url: string; readonly redirect: string }

/** A provider double keyed by path; unknown paths answer 404 so an unexpected request fails loudly. */
function provider(routes: Record<string, () => Response>): { readonly fetch: WebAssetFetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, redirect: init.redirect });
      const parsed = new URL(url);
      const route = routes[`${parsed.hostname}${parsed.pathname}`];
      return route ? route() : new Response("missing", { status: 404 });
    },
  };
}
const json = (value: unknown) => () => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

const stages: string[] = [];
async function stage(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-web-assets-"));
  stages.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(stages.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("web asset search", () => {
  test("Given Openverse results When photos are searched Then only reusable licences come back with source and licence recorded", async () => {
    const double = provider({
      "api.openverse.org/v1/images/": json({ results: [openverseItem(), openverseItem({ id: "00000000-0000-4000-8000-000000000000", license: "by-nc" }), openverseItem({ id: "not-a-uuid" })] }),
    });
    const results = await searchWebAssets({ query: "mountain lake", kind: "photo", limit: 3 }, { fetch: double.fetch });
    expect(results).toEqual([{
      id: `openverse:${UUID}`, kind: "photo", provider: "openverse", title: "Mountain lake", creator: "Ann",
      source_url: "https://www.flickr.com/photos/x/1", license: "CC BY 2.0", license_url: "https://creativecommons.org/licenses/by/2.0/", attribution_required: true,
    }]);
    const request = new URL(double.calls[0]!.url);
    expect(request.searchParams.get("license_type")).toBe("commercial,modification");
    expect(request.searchParams.get("category")).toBe("photograph");
    expect(double.calls.every((call) => call.redirect === "manual")).toBe(true);
  });

  test("Given Iconify results When icons are searched Then icons from sets without a permissive licence are dropped", async () => {
    const double = provider({ "api.iconify.design/search": json({ icons: ["ph:rocket", "gpl:rocket", "ph:bad_name"], collections }) });
    const results = await searchWebAssets({ query: "rocket", kind: "icon" }, { fetch: double.fetch });
    expect(results.map((item) => [item.id, item.license, item.attribution_required])).toEqual([["iconify:ph:rocket", "MIT", false]]);
    expect(results[0]!.source_url).toBe("https://icon-sets.iconify.design/ph/rocket/");
  });

  test("Given no network When searched Then it fails safe with network_unavailable", async () => {
    const offline: WebAssetFetch = async () => { throw new TypeError("fetch failed"); };
    const error = await searchWebAssets({ query: "rocket", kind: "icon" }, { fetch: offline }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebAssetError);
    expect((error as WebAssetError).code).toBe("network_unavailable");
  });

  test("Given malformed queries When searched Then they are rejected before any request", async () => {
    const double = provider({});
    for (const input of [{ query: "", kind: "photo" }, { query: "x".repeat(101), kind: "photo" }, { query: "cat", kind: "video" }, { query: "cat", kind: "icon", limit: 50 }, null]) {
      const error = await searchWebAssets(input, { fetch: double.fetch }).catch((caught: unknown) => caught);
      expect((error as WebAssetError).code).toBe("invalid_request");
    }
    expect(double.calls).toHaveLength(0);
  });
});

describe("web asset import", () => {
  test("Given an Openverse id When imported Then the file lands in assets/web and credits record source and licence from the provider", async () => {
    const dir = await stage();
    const double = provider({
      [`api.openverse.org/v1/images/${UUID}/`]: json(openverseItem()),
      [`api.openverse.org/v1/images/${UUID}/thumb/`]: () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } }),
    });
    const now = () => new Date("2026-09-29T01:00:00.000Z");
    const first = await importWebAsset(dir, { id: `openverse:${UUID}` }, { fetch: double.fetch, now });
    expect(first.credit.file).toBe("assets/web/openverse-mountain-lake-13b0ec75.jpg");
    expect(new Uint8Array(await readFile(path.join(dir, first.credit.file)))).toEqual(JPEG);
    await importWebAsset(dir, { id: `openverse:${UUID}` }, { fetch: double.fetch, now });
    const credits = JSON.parse(await readFile(path.join(dir, WEB_ASSET_CREDITS_FILE), "utf8"));
    expect(credits).toEqual({ schema_version: 1, assets: [{ ...first.credit }] });
    expect(credits.assets[0]).toMatchObject({ source_url: "https://www.flickr.com/photos/x/1", license: "CC BY 2.0", retrieved_at: "2026-09-29T01:00:00.000Z" });
    expect(new URL(double.calls.at(-1)!.url).searchParams.get("full_size")).toBe("true");
  });

  test("Given an Iconify id When imported Then static SVG is saved and the collection licence is re-read", async () => {
    const dir = await stage();
    const double = provider({ "api.iconify.design/collections": json({ ph: collections.ph }), "api.iconify.design/ph/rocket.svg": () => new Response(SVG, { headers: { "content-type": "image/svg+xml" } }) });
    const imported = await importWebAsset(dir, { id: "iconify:ph:rocket" }, { fetch: double.fetch });
    expect(imported.credit).toMatchObject({ file: "assets/web/iconify-ph-rocket.svg", license: "MIT", provider: "iconify" });
    expect(await readFile(path.join(dir, imported.credit.file), "utf8")).toBe(SVG);
  });

  test("Given unsafe or disallowed provider data When imported Then nothing is written", async () => {
    const dir = await stage();
    const cases: Array<readonly [string, Record<string, () => Response>, string]> = [
      ["iconify:ph:rocket", { "api.iconify.design/collections": json({ ph: collections.ph }), "api.iconify.design/ph/rocket.svg": () => new Response('<svg><script>alert(1)</script></svg>') }, "invalid_asset"],
      ["iconify:ph:rocket", { "api.iconify.design/collections": json({ ph: collections.ph }), "api.iconify.design/ph/rocket.svg": () => new Response('<svg><image href="https://tracker.example/x.png"/></svg>') }, "invalid_asset"],
      ["iconify:gpl:rocket", { "api.iconify.design/collections": json({ gpl: collections.gpl }) }, "license_not_allowed"],
      [`openverse:${UUID}`, { [`api.openverse.org/v1/images/${UUID}/`]: json(openverseItem({ license: "by-nd" })) }, "license_not_allowed"],
      [`openverse:${UUID}`, { [`api.openverse.org/v1/images/${UUID}/`]: json(openverseItem()), [`api.openverse.org/v1/images/${UUID}/thumb/`]: () => new Response("<html>not an image</html>") }, "invalid_asset"],
      [`openverse:${UUID}`, { [`api.openverse.org/v1/images/${UUID}/`]: () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }) }, "provider_error"],
      ["https://evil.example/x.png", {}, "invalid_request"],
      ["iconify:../..:x", {}, "invalid_request"],
    ];
    for (const [id, routes, code] of cases) {
      const error = await importWebAsset(dir, { id }, { fetch: provider(routes).fetch }).catch((caught: unknown) => caught);
      expect((error as WebAssetError).code, id).toBe(code);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  test("Given an oversized download When imported Then it stops at the byte cap", async () => {
    const dir = await stage();
    const huge = new Uint8Array(11 * 1024 * 1024);
    huge.set(JPEG);
    const double = provider({ [`api.openverse.org/v1/images/${UUID}/`]: json(openverseItem()), [`api.openverse.org/v1/images/${UUID}/thumb/`]: () => new Response(huge) });
    const error = await importWebAsset(dir, { id: `openverse:${UUID}` }, { fetch: double.fetch }).catch((caught: unknown) => caught);
    expect((error as WebAssetError).code).toBe("too_large");
  });
});

describe("web asset MCP server", () => {
  test("Given the MCP handshake When listed and called Then both tools answer and failures carry only a stable code", async () => {
    const dir = await stage();
    const offline: WebAssetFetch = async () => { throw new TypeError("getaddrinfo ENOTFOUND api.openverse.org"); };
    const context = { stageDir: dir, deps: { fetch: offline } };
    const init = await handleWebAssetsMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, context);
    expect(init?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
    expect(await handleWebAssetsMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, context)).toBeNull();
    const list = await handleWebAssetsMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, context);
    expect((list?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([WEB_ASSET_TOOL_NAMES.search, WEB_ASSET_TOOL_NAMES.import]);
    const call = await handleWebAssetsMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: WEB_ASSET_TOOL_NAMES.search, arguments: { query: "lake", kind: "photo" } } }, context);
    const result = call?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual({ ok: false, error: "network_unavailable" });
    expect(result.content[0]!.text).not.toContain("ENOTFOUND");
    expect((await handleWebAssetsMcpMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" }, context))?.error?.code).toBe(-32601);
  });
});
