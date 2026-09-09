import { expect, test } from "bun:test";
import JSZip from "jszip";
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
