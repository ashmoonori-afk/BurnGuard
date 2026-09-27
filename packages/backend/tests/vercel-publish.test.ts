import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { defaultConfig, saveConfig } from "../src/config";
import { injectMadeWithBadge, MADE_WITH_BADGE_MARKER } from "../src/services/publish-badge";
import { deploymentFiles, isPublicAsset, requestVercel, uploadDeploymentFiles } from "../src/services/vercel-publish";
import { createApp } from "../src/server";
import { sha256 } from "../src/services/export-receipt";

test("Given a validated static export, when prepared for Vercel, then only browser files are included", async () => {
  const zip = new JSZip();
  const html = "<html><body>Hello</body></html>";
  const expected = { schema_version: 1 as const, entrypoint: "index.html", project_revision: 1, project_digest: "digest", input_closure_digest: "closure" };
  zip.file("index.html", html);
  zip.file("burnguard-export.json", JSON.stringify({ ...expected, entries: [{ path: "index.html", size: Buffer.byteLength(html), sha256: sha256(html) }] }));
  const files = await deploymentFiles(await zip.generateAsync({ type: "uint8array" }), expected);
  expect(files.map((file) => file.file)).toEqual(["index.html"]);
  expect(Buffer.from(files[0]!.data).toString()).toBe(html);
  for (const name of [".env", "../secret.js", "attachments/photo.png", "package.json", "vercel.json", "vite.config.js", "a%2fb.js", "private/x.html", "credentials.js"]) expect(isPublicAsset(name)).toBe(false);
  expect(isPublicAsset("assets/site.css")).toBe(true);
  expect(isPublicAsset("assets/tokens.css")).toBe(true);
});

test("Given sensitive basenames at any depth, when selecting public assets, then credentials are blocked but CSS design tokens remain", () => {
  for (const filename of ["secret.js", "secrets.js", "token.js", "TOKENS.mjs", "api-key.js", "api_key.js", "apiKeys.js", "access-token.js", "refresh_tokens.js", "privatekey.js", "privateKeys.js", "site.secret.js", "authToken.js", "credentials.js", "passwords.js"]) {
    expect(isPublicAsset(filename)).toBe(false);
    expect(isPublicAsset(`assets/nested/${filename}`)).toBe(false);
  }
  expect(isPublicAsset("assets/tokens.css")).toBe(true);
  expect(isPublicAsset("assets/tokenizer.js")).toBe(true);
  for (const directory of ["credentials", "tokens", "api-keys", "private-keys", "secrets-prod", "accessTokens", "tokens.css"]) {
    expect(isPublicAsset(`${directory}/data.js`)).toBe(false);
    expect(isPublicAsset(`assets/${directory}/tokens.css`)).toBe(false);
  }
});

test("Given an image over 3MB, when uploading, then Vercel receives bytes and digest references without inline base64", async () => {
  const data = new Uint8Array(4 * 1024 * 1024);
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.vercel.com/v2/files?teamId=team_example");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("x-vercel-digest")).toMatch(/^[a-f0-9]{40}$/);
    expect(new Headers(init?.headers).get("Content-Length")).toBe(String(data.length));
    expect(init?.body).toBeInstanceOf(Buffer);
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const result = await uploadDeploymentFiles([{ file: "image.png", data }], "secret", "team_example", new AbortController().signal, fetcher);
  expect(result[0]).toEqual({ file: "image.png", size: data.length, sha: expect.any(String) });
});

test("Given the publish route, when authority or request shape is invalid, then it rejects before accessing exports or providers", async () => {
  const app = createApp({ capability: "test-capability", appAuthority: "localhost:14071" });
  const headers = { host: "localhost:14071", origin: "http://localhost:14071", "content-type": "application/json" };
  expect((await app.request("http://localhost:14071/api/exports/test/vercel", { method: "POST", headers, body: "{}" })).status).toBe(403);
  const response = await app.request("http://localhost:14071/api/exports/test/vercel", { method: "POST", headers: { ...headers, "x-burnguard-capability": "test-capability" }, body: JSON.stringify({ token: "private-secret-token", unexpected: true }) });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("private-secret-token");
});

test("Given provider responses, when checking deployment, then only validated URLs and readiness leave the service", async () => {
  const respond = (value: unknown, status = 200) => (async () => Response.json(value, { status })) as typeof fetch;
  const signal = new AbortController().signal;
  expect(await requestVercel("/v13/deployments/dpl_abc", "secret", undefined, signal, undefined, respond({ id: "dpl_abc", url: "example.vercel.app", readyState: "READY" }))).toEqual({ schema_version: 1, id: "dpl_abc", url: "https://example.vercel.app", ready: true });
  await expect(requestVercel("/v13/deployments/dpl_abc", "secret", undefined, signal, undefined, respond({ id: "dpl_abc", url: "evil.example", readyState: "READY" }))).rejects.toThrow("publish_provider_failed");
  await expect(requestVercel("/v13/deployments/dpl_abc", "secret", undefined, signal, undefined, respond({ message: "private secret" }, 403))).rejects.toThrow("publish_auth_failed");
});

test("Given internal generation notes and font licenses When publishing Then notes stay private and website assets publish", async () => {
  const zip = new JSZip();
  const expected = { schema_version: 1 as const, entrypoint: "index.html", project_revision: 20, project_digest: "digest", input_closure_digest: "closure" };
  const contents = { "index.html": '<html><body>Hello</body></html>', "assets/site.css": "body{color:black}", "assets/generated-assets.json": "{}", "assets/image-prompts.txt": "private prompt", "fonts/manifest.json": "{}", "fonts/DMSans-OFL.txt": "font license", "attachments/source.pdf": "private document", "secrets.js": "private credential" };
  for (const [name, data] of Object.entries(contents)) zip.file(name, data);
  zip.file("burnguard-export.json", JSON.stringify({ ...expected, entries: Object.entries(contents).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, data]) => ({ path, size: Buffer.byteLength(data), sha256: sha256(data) })) }));
  const files = await deploymentFiles(await zip.generateAsync({ type: "uint8array" }), expected);
  expect(files.map(file => file.file).sort()).toEqual(["assets/site.css", "fonts/DMSans-OFL.txt", "index.html"]);
});

async function archive(contents: Record<string, string>, entrypoint: string) {
  const zip = new JSZip();
  const expected = { schema_version: 1 as const, entrypoint, project_revision: 3, project_digest: "digest", input_closure_digest: "closure" };
  for (const [name, data] of Object.entries(contents)) zip.file(name, data);
  zip.file("burnguard-export.json", JSON.stringify({ ...expected, entries: Object.entries(contents).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, data]) => ({ path, size: Buffer.byteLength(data), sha256: sha256(data) })) }));
  return { bytes: await zip.generateAsync({ type: "uint8array" }), expected };
}

describe("publish badge", () => {
  const page = "<html><body><h1>Site</h1></body></html>";

  test("Given badge disabled When preparing deployment files Then every file is byte-identical to the export", async () => {
    const { bytes, expected } = await archive({ "index.html": page, "about.html": page }, "index.html");
    const files = await deploymentFiles(bytes, expected, { badge: false });
    for (const file of files) expect(Buffer.from(file.data).toString()).toBe(page);
    expect((await deploymentFiles(bytes, expected)).map((file) => Buffer.from(file.data).toString())).toEqual([page, page]);
  });

  test("Given badge enabled When preparing deployment files Then only the entrypoint carries the badge", async () => {
    const { bytes, expected } = await archive({ "index.html": page, "about.html": page, "assets/site.css": "body{}" }, "index.html");
    const files = new Map((await deploymentFiles(bytes, expected, { badge: true })).map((file) => [file.file, Buffer.from(file.data).toString()]));
    expect(files.get("index.html")).toBe(injectMadeWithBadge(page));
    expect(files.get("about.html")).toBe(page);
    expect(files.get("assets/site.css")).toBe("body{}");
  });

  test("Given a nested entrypoint When badged Then the synthesized redirect index stays untouched", async () => {
    const { bytes, expected } = await archive({ "site/home.html": page }, "site/home.html");
    const files = new Map((await deploymentFiles(bytes, expected, { badge: true })).map((file) => [file.file, Buffer.from(file.data).toString()]));
    expect(files.get("site/home.html")).toBe(injectMadeWithBadge(page));
    expect(files.get("index.html")).not.toContain(MADE_WITH_BADGE_MARKER);
  });

  test("Given badged files When uploaded Then the SHA1 digest and size describe the mutated bytes", async () => {
    const { bytes, expected } = await archive({ "index.html": page }, "index.html");
    const files = await deploymentFiles(bytes, expected, { badge: true });
    const uploaded: { digest: string | null; body: Buffer }[] = [];
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      uploaded.push({ digest: new Headers(init?.headers).get("x-vercel-digest"), body: init?.body as Buffer });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const references = await uploadDeploymentFiles(files, "fixture-token", undefined, new AbortController().signal, fetcher);
    const badged = Buffer.from(injectMadeWithBadge(page));
    const sha = createHash("sha1").update(badged).digest("hex");
    expect(uploaded).toEqual([{ digest: sha, body: badged }]);
    expect(references).toEqual([{ file: "index.html", sha, size: badged.byteLength }]);
  });

  test("Given the publish route When the badge flag or token source is invalid Then it answers 400 before touching exports", async () => {
    const app = createApp({ capability: "test-capability", appAuthority: "localhost:14071" });
    const headers = { host: "localhost:14071", origin: "http://localhost:14071", "content-type": "application/json", "x-burnguard-capability": "test-capability" };
    const post = (body: unknown) => app.request("http://localhost:14071/api/exports/missing/vercel", { method: "POST", headers, body: JSON.stringify(body) });
    const saved = "fixtureSavedVercel_0123456789";
    try {
      await saveConfig({ ...structuredClone(defaultConfig), vercelToken: null });
      const nonBoolean = await post({ token: "fixtureVercelToken_01", badge: "yes" });
      expect(nonBoolean.status).toBe(400);
      expect((await nonBoolean.json()).error.code).toBe("invalid_body");
      const missing = await post({ badge: true });
      expect(missing.status).toBe(400);
      expect((await missing.json()).error.code).toBe("publish_token_required");
      await saveConfig({ ...structuredClone(defaultConfig), vercelToken: saved });
      const withSaved = await post({ badge: false });
      expect(withSaved.status).toBe(404);
      expect(await withSaved.text()).not.toContain(saved);
    } finally {
      await saveConfig(structuredClone(defaultConfig));
    }
  });
});

test("Given a ready production alias When checking deployment Then the shared URL uses that alias", async () => {
  const fetcher = (async () => Response.json({ id: "dpl_test", url: "preview.vercel.app", readyState: "READY", alias: ["https://invalid.example", "public-site.vercel.app"] })) as typeof fetch;
  expect((await requestVercel("/v13/deployments/dpl_test", "test-token", undefined, new AbortController().signal, undefined, fetcher)).url).toBe("https://public-site.vercel.app");
});
