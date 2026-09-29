import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HarMaskError, MASKED, maskHar } from "./har-mask";

const CAPABILITY = "c4p4b1l1tyV4lu3-0123456789abcdef";
const header = (name: string, value: string) => ({ name, value });
const entry = (request: Record<string, unknown>, response: Record<string, unknown>) => ({ startedDateTime: "2026-09-29T01:00:00.000Z", time: 12, request: { method: "GET", httpVersion: "HTTP/1.1", headers: [], cookies: [], queryString: [], ...request }, response: { status: 200, statusText: "OK", httpVersion: "HTTP/1.1", headers: [], cookies: [], content: { size: 0, mimeType: "application/json", text: "" }, ...response } });
const fixture = () => ({ log: { version: "1.2", creator: { name: "qa", version: "1" }, entries: [
  entry({ url: "http://127.0.0.1:14070/api/bootstrap" }, { headers: [header("x-burnguard-capability", CAPABILITY), header("set-cookie", `burnguard_capability=${CAPABILITY}; HttpOnly; SameSite=Strict; Path=/api`)], content: { size: 60, mimeType: "application/json", text: JSON.stringify({ data: { capability: CAPABILITY } }) } }),
  entry({ url: `http://127.0.0.1:14070/api/projects?dir=%2Fhome%2Falice%2F.burnguard%2Fprojects&capability=${CAPABILITY}`, headers: [header("x-burnguard-capability", CAPABILITY), header("Cookie", `theme=dark; burnguard_capability=${CAPABILITY}`), header("Authorization", "Bearer sk-live-provider-token-1234")], cookies: [{ name: "burnguard_capability", value: CAPABILITY }], queryString: [{ name: "capability", value: CAPABILITY }] },
    { content: { size: 90, mimeType: "application/json", text: JSON.stringify({ data: { dir_path: "/home/alice/.burnguard/projects/p1", win: "C:\\Users\\alice\\AppData\\BurnGuard", qa: "/tmp/qa-home-77/profile" } }) } }),
  entry({ url: "http://127.0.0.1:14070/api/sessions/s1/events" }, { content: { size: 40, mimeType: "text/event-stream; charset=utf-8", encoding: "base64", text: Buffer.from(`data: {"path":"/Users/bob/work","token":"${CAPABILITY}"}\n\n`).toString("base64") } }),
] } });

describe("HAR masking for the pre-release UX QA stage", () => {
  test("Given a HAR with the capability in headers, cookies, query, bodies and a base64 stream plus private paths, when masked, then no secret or private path remains and placeholders take their place", () => {
    const { har, report } = maskHar(fixture(), [{ path: "/tmp/qa-home-77", placeholder: "<qa-home>" }]);
    const text = JSON.stringify(har);
    for (const secret of [CAPABILITY, "sk-live-provider-token-1234", "/home/alice", "C:\\\\Users\\\\alice", "%2Fhome%2Falice", "/tmp/qa-home-77"]) expect(text).not.toContain(secret);
    type Entry = { readonly request: { readonly url: string; readonly method: string; readonly headers: readonly { readonly name: string; readonly value: string }[] }; readonly response: { readonly status: number; readonly content: { readonly text: string } } };
    const entries = (har as { readonly log: { readonly entries: readonly Entry[] } }).log.entries;
    const stream = Buffer.from(String(entries[2]!.response.content.text), "base64").toString("utf8");
    expect(stream).toBe(`data: {"path":"<home>/work","token":"${MASKED}"}\n\n`);
    expect(JSON.parse(String(entries[1]!.response.content.text)).data).toEqual({ dir_path: "<home>/.burnguard/projects/p1", win: "<home>\\AppData\\BurnGuard", qa: "<qa-home>/profile" });
    expect(entries[1]!.request.headers.map(item => [item.name, item.value])).toEqual([["x-burnguard-capability", MASKED], ["Cookie", MASKED], ["Authorization", MASKED]]);
    expect(entries[1]!.request.url).toBe(`http://127.0.0.1:14070/api/projects?dir=<home>%2F.burnguard%2Fprojects&capability=${MASKED}`);
    expect([entries[0]!.response.status, entries[1]!.request.method]).toEqual([200, "GET"]);
    expect(report).toMatchObject({ headers: 5, cookies: 1, params: 1 });
    expect(report.secret_values).toBe(2);
  });

  test("Given secrets that appear only in bodies, form params or quoted cookies, when masked, then they are collected and masked too", () => {
    const token = "provider-token-9876543210";
    const har = { log: { entries: [
      entry({ url: "http://127.0.0.1:14070/api/bootstrap" }, { content: { size: 60, mimeType: "application/json", text: JSON.stringify({ ok: true, data: { capability: CAPABILITY } }) } }),
      entry({ method: "POST", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/x-www-form-urlencoded", text: `token=${token}`, params: [{ name: "token", value: token }] }, headers: [header("cookie", `theme="${"quoted-cookie-value-1234"}"`)] }, { content: { size: 40, mimeType: "application/json", text: JSON.stringify({ echo: `${CAPABILITY} ${token} quoted-cookie-value-1234 c:\\users\\alice\\x /root/.burnguard/y` }) } }),
    ] } };
    const text = JSON.stringify(maskHar(har).har);
    for (const secret of [CAPABILITY, token, "quoted-cookie-value-1234", "alice", "/root/"]) expect(text).not.toContain(secret);
  });

  test("Given BurnGuard settings requests carrying provider tokens, when masked, then every token field value is masked everywhere", () => {
    // Fake values are assembled at runtime so no secret-shaped literal sits in the source.
    const fake = (label: string, length: number) => [label, "q".repeat(length)].join("-");
    const tokens = { vercel_token: fake("vercel", 6), figma_personal_access_token: fake("figd", 20), commandcode_api_key: fake("cc", 20) };
    const har = { log: { entries: [entry({ method: "PATCH", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/json", text: JSON.stringify({ ...tokens, llm_api_keys: { gemini: fake("gemini", 12), xai: fake("xai", 8) }, theme_name: "a-long-ordinary-theme-name" }) } }, { content: { size: 20, mimeType: "application/json", text: JSON.stringify({ data: { saved: true, echo: Object.values(tokens).join(" ") } }) } })] } };
    const { har: masked, report } = maskHar(har);
    const text = JSON.stringify(masked);
    for (const value of [...Object.values(tokens), fake("gemini", 12), fake("xai", 8)]) expect(text).not.toContain(value);
    expect(text).toContain("a-long-ordinary-theme-name");
    expect(report.secret_values).toBe(5);
  });

  test("Given a design-system tokens response, when masked, then token values stay readable in it and in artifact pages", () => {
    const family = "Inter, system-ui, sans-serif";
    const har = { log: { entries: [
      entry({ url: "http://127.0.0.1:14070/api/design-systems/neon/tokens" }, { content: { size: 80, mimeType: "application/json", text: JSON.stringify({ data: { layout: { tokens: { "--font-body": family, "--sp-2": "calc(4px * 2)" } }, pages: [{ layout_tokens: { "--layout-max": "1200px-wide" } }] } }) } }),
      entry({ url: "http://127.0.0.1:14070/runtime/projects/p1/index.html" }, { content: { size: 40, mimeType: "text/html", text: `<style>body{font-family:${family}}</style>` } }),
    ] } };
    const { har: masked, report } = maskHar(har);
    const text = JSON.stringify(masked);
    expect(text.split(family).length - 1).toBe(2);
    expect(text).toContain("calc(4px * 2)");
    expect(report.secret_values).toBe(0);
  });

  test("Given short values under loosely named body fields, when masked, then they are not treated as secrets and unrelated URLs stay readable", () => {
    const har = { log: { entries: [entry({ url: "http://127.0.0.1:14070/api/projects/abc" }, { content: { size: 30, mimeType: "application/json", text: JSON.stringify({ data: [{ key: "projects", token: "short" }] }) } })] } };
    const masked = maskHar(har);
    expect((masked.har as { readonly log: { readonly entries: readonly { readonly request: { readonly url: string } }[] } }).log.entries[0]!.request.url).toBe("http://127.0.0.1:14070/api/projects/abc");
    expect(masked.report.secret_values).toBe(0);
  });

  test("Given a bootstrap response whose body carries no recognisable capability, or a secret inside a binary-typed base64 body, when masked, then masking fails closed with a typed error", () => {
    const unknownBootstrap = { log: { entries: [entry({ url: "http://127.0.0.1:14070/api/bootstrap" }, { content: { size: 10, mimeType: "text/plain", text: `launch ${CAPABILITY}` } })] } };
    expect(() => maskHar(unknownBootstrap)).toThrow(new HarMaskError("capability_not_found"));
    const binary = { log: { entries: [entry({ url: "http://127.0.0.1:14070/api/x", headers: [header("x-burnguard-capability", CAPABILITY)] }, { content: { size: 40, mimeType: "application/octet-stream", encoding: "base64", text: Buffer.from(`{"c":"${CAPABILITY}"}`).toString("base64") } })] } };
    expect(() => maskHar(binary)).toThrow(new HarMaskError("secret_remains"));
  });

  test("Given input that is not a HAR, when masked, then a typed error is raised", () => {
    expect(() => maskHar({ log: {} })).toThrow(HarMaskError);
    expect(() => maskHar([])).toThrow(HarMaskError);
  });

  test("Given the CLI, when run on a HAR, then it writes a 0600 masked copy, prints only counts, and refuses to overwrite its input", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-har-mask-"));
    try {
      const input = path.join(dir, "raw.har");
      const output = path.join(dir, "shared.har");
      await writeFile(input, JSON.stringify(fixture()));
      const run = Bun.spawnSync(["bun", path.join(import.meta.dir, "har-mask.ts"), input, output, "--root", "/tmp/qa-home-77=<qa-home>"]);
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).not.toContain(CAPABILITY);
      expect(JSON.parse(run.stdout.toString())).toMatchObject({ schema_version: 1, output: "shared.har" });
      expect(await readFile(output, "utf8")).not.toContain(CAPABILITY);
      if (process.platform !== "win32") expect((await stat(output)).mode & 0o777).toBe(0o600);
      const again = Bun.spawnSync(["bun", path.join(import.meta.dir, "har-mask.ts"), input, output]);
      expect(JSON.parse(again.stderr.toString())).toEqual({ error: "output_exists" });
      const link = path.join(dir, "link.har");
      await symlink(input, link);
      const viaLink = Bun.spawnSync(["bun", path.join(import.meta.dir, "har-mask.ts"), input, link]);
      expect(JSON.parse(viaLink.stderr.toString())).toEqual({ error: "output_exists" });
      expect(await readFile(input, "utf8")).toContain(CAPABILITY);
      const same = Bun.spawnSync(["bun", path.join(import.meta.dir, "har-mask.ts"), input, input]);
      expect(same.exitCode).toBe(1);
      expect(JSON.parse(same.stderr.toString())).toEqual({ error: "invalid_arguments" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
