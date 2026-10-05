import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HarMaskError, MASKED, maskHar, rootPattern, type PrivateRoot } from "./har-mask";

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

  test("Given secrets in a base64 request body or in a raw form body without params, when masked, then they are collected and masked, and a binary request body carrying a secret fails closed", () => {
    const password = ["request", "body", "password", "4938271"].join("-");
    const token = ["raw", "form", "token", "1234567890"].join("-");
    const har = { log: { entries: [
      entry({ method: "POST", url: "http://127.0.0.1:14070/api/a", postData: { mimeType: "application/json", encoding: "base64", text: Buffer.from(JSON.stringify({ password })).toString("base64") } }, { content: { size: 10, mimeType: "application/json", text: JSON.stringify({ echo: password }) } }),
      entry({ method: "POST", url: "http://127.0.0.1:14070/api/b", postData: { mimeType: "application/x-www-form-urlencoded", text: `theme=dark&access_token=${encodeURIComponent(token)}` } }, {}),
    ] } };
    const { har: masked, report } = maskHar(har);
    type Entry = { readonly request: { readonly postData: { readonly text: string } } };
    const entries = (masked as { readonly log: { readonly entries: readonly Entry[] } }).log.entries;
    expect(JSON.parse(Buffer.from(entries[0]!.request.postData.text, "base64").toString("utf8"))).toEqual({ password: MASKED });
    expect(entries[1]!.request.postData.text).toBe(`theme=dark&access_token=${MASKED}`);
    expect(JSON.stringify(masked)).not.toContain(password);
    expect(report.secret_values).toBe(2);
    const spaced = ["spaced", "form", "password", "4938271"].join(" ");
    const form = new URLSearchParams({ password: spaced, theme: "dark" }).toString();
    const spacedHar = { log: { entries: [
      entry({ method: "POST", url: "http://127.0.0.1:14070/api/d", postData: { mimeType: "application/x-www-form-urlencoded; charset=utf-8", text: form } }, {}),
      entry({ method: "POST", url: "http://127.0.0.1:14070/api/e", postData: { mimeType: "application/x-www-form-urlencoded", encoding: "base64", text: Buffer.from(form).toString("base64") } }, {}),
    ] } };
    const spacedEntries = (maskHar(spacedHar).har as { readonly log: { readonly entries: readonly Entry[] } }).log.entries;
    expect(new URLSearchParams(spacedEntries[0]!.request.postData.text).get("password")).toBe(MASKED);
    expect(new URLSearchParams(Buffer.from(spacedEntries[1]!.request.postData.text, "base64").toString("utf8")).get("password")).toBe(MASKED);
    // A form encoder may spell each space either way; a mixed spelling in the request or only in a plain-text echo fails closed.
    const mixed = encodeURIComponent(spaced).replace("%20", "+");
    const mixedRequest = { log: { entries: [entry({ method: "POST", url: "http://127.0.0.1:14070/api/f", postData: { mimeType: "application/x-www-form-urlencoded", text: `password=${mixed}&theme=dark` } }, {})] } };
    expect(() => maskHar(mixedRequest)).toThrow(new HarMaskError("secret_remains"));
    const mixedEcho = { log: { entries: [entry({ method: "POST", url: "http://127.0.0.1:14070/api/g", postData: { mimeType: "application/x-www-form-urlencoded", encoding: "base64", text: Buffer.from(form).toString("base64") } }, { content: { size: 30, mimeType: "text/plain", encoding: "base64", text: Buffer.from(`echo=${mixed}&note=ordinary+text`).toString("base64") } })] } };
    expect(() => maskHar(mixedEcho)).toThrow(new HarMaskError("secret_remains"));
    // A quote or backslash kept literal in a mixed spelling is JSON-escaped in a JSON echo, in base64, and in a URL query.
    for (const special of ['quoted"password', "back\\slash"]) {
      const secret = ["synthetic", special, "493827"].join(" ");
      const literal = encodeURIComponent(secret).replace("%20", "+").replace("%22", '"').replace("%5C", "\\");
      const login = { method: "POST", url: "http://127.0.0.1:14070/api/h", postData: { mimeType: "application/json", text: JSON.stringify({ password: secret }) } };
      for (const echo of [
        entry(login, { content: { size: 30, mimeType: "application/json", text: JSON.stringify({ echo: literal }) } }),
        entry(login, { content: { size: 30, mimeType: "application/json", encoding: "base64", text: Buffer.from(JSON.stringify({ echo: literal })).toString("base64") } }),
        entry({ ...login, url: `http://127.0.0.1:14070/api/h?echo=${literal}` }, {}),
      ]) expect(() => maskHar({ log: { entries: [echo] } })).toThrow(new HarMaskError("secret_remains"));
    }
    const binary = { log: { entries: [entry({ method: "POST", url: "http://127.0.0.1:14070/api/c", headers: [header("x-burnguard-capability", CAPABILITY)], postData: { mimeType: "application/octet-stream", encoding: "base64", text: Buffer.from(`{"c":"${CAPABILITY}"}`).toString("base64") } }, {})] } };
    expect(() => maskHar(binary)).toThrow(new HarMaskError("secret_remains"));
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
      // Windows has no group or other mode bits: the file inherits the evidence directory's ACL, and Node maps the requested
      // 0600 to "writable by its owner", which stat reports as 0666 (a read-only file would read 0444).
      expect((await stat(output)).mode & 0o777).toBe(process.platform === "win32" ? 0o666 : 0o600);
      const again = Bun.spawnSync(["bun", path.join(import.meta.dir, "har-mask.ts"), input, output]);
      expect(JSON.parse(again.stderr.toString())).toEqual({ error: "output_exists" });
      const alias = path.join(dir, "alias");
      await symlink(dir, alias, process.platform === "win32" ? "junction" : "dir");
      const link = path.join(alias, "raw.har");
      const viaLink = Bun.spawnSync(["bun", path.join(import.meta.dir, "har-mask.ts"), input, link]);
      expect(JSON.parse(viaLink.stderr.toString())).toEqual({ error: "output_exists" });
      expect(await readFile(input, "utf8")).toContain(CAPABILITY);
      const same = Bun.spawnSync(["bun", path.join(import.meta.dir, "har-mask.ts"), input, input]);
      expect(same.exitCode).toBe(1);
      expect(JSON.parse(same.stderr.toString())).toEqual({ error: "invalid_arguments" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

type MaskedEntry = { readonly request: { readonly url: string; readonly postData?: { readonly text: string } }; readonly response: { readonly content: { readonly text: string } } };
const API = "http://127.0.0.1:14070/api/projects";
const bootstrap = () => entry({ url: "http://127.0.0.1:14070/api/bootstrap" }, { content: { size: 60, mimeType: "application/json", text: JSON.stringify({ data: { capability: CAPABILITY } }) } });
const jsonBody = (value: unknown) => ({ content: { size: 80, mimeType: "application/json", text: JSON.stringify(value) } });
/** Masks a HAR made of the bootstrap entry plus the given ones; returns the serialized result and the given entries, masked. */
const mask = (entries: readonly unknown[], roots: readonly PrivateRoot[] = []) => {
  const { har } = maskHar({ log: { entries: [bootstrap(), ...entries] } }, roots);
  return { text: JSON.stringify(har), entries: (har as { readonly log: { readonly entries: readonly MaskedEntry[] } }).log.entries.slice(1) };
};
const qaHome = (root: string): PrivateRoot[] => [{ path: root, placeholder: "<qa-home>" }];

// Every case feeds maskHar a path string of a fixed flavor, so the Windows and POSIX cases both run on every host OS.
describe("HAR masking of caller-given roots in the forms a HAR carries them", () => {
  test("Given a Windows drive root passed with --root, when the HAR carries it JSON-escaped, with forward slashes, in another letter case and percent-encoded, then every form becomes the placeholder", () => {
    const root = "D:\\bg-qa\\run-42";
    const url = `${API}?dir=${encodeURIComponent(`${root}\\projects`)}&alt=${encodeURIComponent(root).toLowerCase()}`;
    const masked = mask([entry({ url }, jsonBody({ data: { dir_path: `${root}\\projects\\p1`, slashes: "D:/bg-qa/run-42/projects/p1", lower: "d:\\BG-QA\\RUN-42\\p2", file_url: "file:///D:/bg-qa/run-42/index.html" } }))], qaHome(root));
    expect(masked.text.toLowerCase()).not.toContain("bg-qa");
    expect(JSON.parse(masked.entries[0]!.response.content.text).data).toEqual({ dir_path: "<qa-home>\\projects\\p1", slashes: "<qa-home>/projects/p1", lower: "<qa-home>\\p2", file_url: "file:///<qa-home>/index.html" });
    expect(masked.entries[0]!.request.url).toBe(`${API}?dir=<qa-home>%5Cprojects&alt=<qa-home>`);
  });

  test("Given a Windows UNC root passed with --root, when the HAR carries it JSON-escaped, with forward slashes and percent-encoded, then every form becomes the placeholder", () => {
    const root = "\\\\qa-server\\share\\run-42";
    const masked = mask([entry({ url: `${API}?dir=${encodeURIComponent(root)}` }, jsonBody({ data: { profile: `${root}\\profile`, slashes: "//qa-server/share/run-42/profile" } }))], qaHome(root));
    expect(masked.text).not.toContain("qa-server");
    expect(JSON.parse(masked.entries[0]!.response.content.text).data).toEqual({ profile: "<qa-home>\\profile", slashes: "<qa-home>/profile" });
    expect(masked.entries[0]!.request.url).toBe(`${API}?dir=<qa-home>`);
  });

  test.each(["/tmp/qa-home-77", "/home/qa/project", "/Users/qa/project"])("Given the POSIX root %s passed with --root, when a request URL carries it percent-encoded in either hex case, then the URL and the body show only the placeholder", root => {
    const url = `${API}?dir=${encodeURIComponent(`${root}/projects`)}&alt=${encodeURIComponent(root).replaceAll("%2F", "%2f")}`;
    const masked = mask([entry({ url, queryString: [{ name: "dir", value: `${root}/projects` }] }, jsonBody({ data: { dir_path: `${root}/projects/p1` } }))], qaHome(root));
    expect(masked.text).not.toContain(root);
    expect(masked.text.toLowerCase()).not.toContain(encodeURIComponent(root).toLowerCase());
    expect(masked.entries[0]!.request.url).toBe(`${API}?dir=<qa-home>%2Fprojects&alt=<qa-home>`);
    expect(JSON.parse(masked.entries[0]!.response.content.text).data).toEqual({ dir_path: "<qa-home>/projects/p1" });
  });

  test.each(["NFC", "NFD"] as const)("Given a macOS root with an accented name passed with --root in %s, when the HAR carries it in both Unicode normal forms, raw and percent-encoded, then every form becomes the placeholder", form => {
    const composed = "/Volumes/QA/caf\u00e9-run";
    const decomposed = composed.normalize("NFD");
    const url = `${API}?dir=${encodeURIComponent(decomposed)}&alt=${encodeURIComponent(composed)}`;
    const masked = mask([entry({ url }, jsonBody({ data: { nfd: `${decomposed}/p1`, nfc: `${composed}/p2` } }))], qaHome(composed.normalize(form)));
    expect(masked.text).not.toContain("caf");
    expect(masked.text).not.toContain("-run");
    expect(JSON.parse(masked.entries[0]!.response.content.text).data).toEqual({ nfd: "<qa-home>/p1", nfc: "<qa-home>/p2" });
    expect(masked.entries[0]!.request.url).toBe(`${API}?dir=<qa-home>&alt=<qa-home>`);
  });

  test.each(["/Volumes/QA/caf\u00e9-run", "D:\\QA\\caf\u00e9-run"])("Given the root %s with a non-ASCII character, when a JSON body writes that character as a \\u escape at one and two escaping levels, then every form becomes the placeholder", root => {
    const escaped = (levels: number) => root.replaceAll("\\", "\\".repeat(2 ** levels)).replace("\u00e9", `${"\\".repeat(2 ** (levels - 1))}u00E9`);
    const text = `{"data":{"one":"${escaped(1)}-p1","two":"${escaped(2)}-p2"}}`;
    const masked = mask([entry({ url: API }, { content: { size: 80, mimeType: "application/json", text } })], qaHome(root));
    expect(masked.text).not.toContain("caf");
    expect(masked.entries[0]!.response.content.text).toBe(`{"data":{"one":"<qa-home>-p1","two":"<qa-home>-p2"}}`);
  });

  test.each(["/Volumes/QA/caf\u00e9-run", "D:\\QA\\caf\u00e9-run", "\\\\qa-server\\share\\run-42"])("Given the root %s, when a URL carries it double-percent-encoded, then it becomes the placeholder", root => {
    const masked = mask([entry({ url: `${API}?dir=${encodeURIComponent(encodeURIComponent(`${root}/p1`))}` }, jsonBody({ data: {} }))], qaHome(root));
    expect(masked.entries[0]!.request.url).toBe(`${API}?dir=<qa-home>%252Fp1`);
  });

  test.each([4, 6])("Given a Unicode Windows root nested %i levels deep in JSON, when masked, then the decoded path is the placeholder", levels => {
    const root = "D:\\QA\\caf\u00e9-run";
    let text = root;
    for (let level = 0; level < levels; level += 1) text = JSON.stringify({ echo: text });
    const masked = mask([entry({ url: API }, { content: { size: text.length, mimeType: "application/json", text } })], qaHome(root));
    let decoded = masked.entries[0]!.response.content.text;
    for (let level = 0; level < levels; level += 1) decoded = JSON.parse(decoded).echo;
    expect(decoded).toBe("<qa-home>");
    expect(masked.text).not.toContain("caf");
  });

  test.each(["\\\\qa-server\\share\\run-42", "D:\\bg-qa\\run-42", "/tmp/qa-home-77"])("Given the root %s, when its pattern is built, then it has no unbounded quantifier and a long backslash run before the root still masks it", root => {
    // An unbounded separator quantifier makes matching polynomial on long backslash runs; counting them pins the bound without timing anything.
    const source = rootPattern(root).source;
    let unbounded = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "\\") { index += 1; continue; }
      if (source[index] === "+" || source[index] === "*" || (source[index] === "{" && /^\{\d+,\}/u.test(source.slice(index)))) unbounded += 1;
    }
    expect(unbounded).toBe(0);
    const masked = mask([entry({ url: API }, jsonBody({ data: { run: `${"\\".repeat(2048)}x ${root}` } }))], qaHome(root));
    expect(JSON.parse(masked.entries[0]!.response.content.text).data).toEqual({ run: `${"\\".repeat(2048)}x <qa-home>` });
  });

  test("Given a root with spaces passed with --root, when a URL carries the spaces as %20 or as form-encoded plus signs, then both forms become the placeholder", () => {
    const root = "/Volumes/QA Disk/run 42";
    const masked = mask([entry({ url: `${API}?dir=${encodeURIComponent(root)}&alt=%2FVolumes%2FQA+Disk%2Frun+42` }, jsonBody({ data: { dir_path: `${root}/p1` } }))], qaHome(root));
    expect(masked.text).not.toContain("Disk");
    expect(masked.entries[0]!.request.url).toBe(`${API}?dir=<qa-home>&alt=<qa-home>`);
  });
});

describe("HAR masking of collected secrets that need JSON escaping", () => {
  // Assembled at runtime so no secret-shaped literal sits in the source: one value holds a quote, one a backslash.
  const quoted = ["hunter2", "quoted-pass-0123"].join("\"");
  const backslashed = ["pa", "ss-word-back-0123"].join("\\");

  test.each([1, 2])("Given a collected password echoed at URL-encoding depth %s with lowercase hex, then sharing fails closed", depth => {
    const password = ["percent", "secret", "012345"].join("/ +");
    let echo = password;
    for (let level = 0; level < depth; level += 1) echo = encodeURIComponent(echo).replace(/%[0-9A-F]{2}/g, sequence => sequence.toLowerCase());
    const input = { log: { entries: [entry({ method: "PATCH", url: API, postData: { mimeType: "application/json", text: JSON.stringify({ password }) } }, { content: { mimeType: "application/json", text: JSON.stringify({ echo }) } })] } };
    expect(() => maskHar(input)).toThrow("secret_remains");
  });

  test.each(["plain", "base64", "nested"] as const)("Given a collected password echoed with Unicode JSON escapes in a %s text body, when masked, then semantic decoding recovers only the placeholder", encoding => {
    const password = ["private", "pass", "012345"].join("-");
    const escaped = [...password].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    let text = `{"echo":"${escaped}","${escaped}":"ordinary","keep":"readable","items":["${escaped}"]}`;
    if (encoding === "nested") text = JSON.stringify({ echo: text });
    const input = { log: { entries: [entry({ method: "PATCH", url: API, postData: { mimeType: "application/json", text: JSON.stringify({ password }) } }, { content: { size: text.length, mimeType: "application/json", text: encoding === "base64" ? Buffer.from(text).toString("base64") : text, ...(encoding === "base64" ? { encoding } : {}) } })] } };
    const original = JSON.stringify(input);
    const result = maskHar(input);
    const output = JSON.parse(JSON.stringify(result.har)) as { readonly log: { readonly entries: readonly MaskedEntry[] } };
    let decoded = output.log.entries[0]!.response.content.text;
    if (encoding === "base64") decoded = Buffer.from(decoded, "base64").toString("utf8");
    if (encoding === "nested") decoded = JSON.parse(decoded).echo;
    expect(JSON.parse(decoded)).toEqual({ echo: MASKED, [MASKED]: "ordinary", keep: "readable", items: [MASKED] });
    expect(JSON.stringify(JSON.parse(decoded))).not.toContain(password);
    expect(JSON.parse(output.log.entries[0]!.request.postData!.text)).toEqual({ password: MASKED });
    expect(result.report.secret_values).toBe(1);
    expect(JSON.stringify(input)).toBe(original);
  });

  test("Given a collected password in URL-encoded Unicode JSON, then sharing fails closed", () => {
    const password = ["private", "pass", "012345"].join("-");
    const escaped = [...password].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const echo = encodeURIComponent(`"${escaped}"`);
    const input = { log: { entries: [entry({ method: "PATCH", url: API, postData: { mimeType: "application/json", text: JSON.stringify({ password }) } }, { content: { mimeType: "application/json", text: JSON.stringify({ echo }) } })] } };
    expect(() => maskHar(input)).toThrow("secret_remains");
  });

  test("Given a collected UTF-8 password in a binary base64 body, then sharing fails closed without rewriting it", () => {
    const password = ["private", "p\u00e4ss", "012345"].join("-");
    const text = Buffer.from(password, "utf8").toString("base64");
    const input = { log: { entries: [entry({ method: "PATCH", url: API, postData: { mimeType: "application/json", text: JSON.stringify({ password }) } }, { content: { mimeType: "application/octet-stream", encoding: "base64", text } })] } };
    expect(() => maskHar(input)).toThrow("secret_remains");
    expect(input.log.entries[0]!.response.content.text).toBe(text);
  });

  test("Given a collected password echoed with Unicode JSON escapes in a binary base64 body, when masked, then the residual check fails closed", () => {
    const password = ["private", "pass", "012345"].join("-");
    const escaped = [...password].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const text = `{"echo":"${escaped}"}`;
    const echoed = { content: { size: text.length, mimeType: "application/octet-stream", encoding: "base64", text: Buffer.from(text).toString("base64") } };
    expect(() => mask([entry({ method: "PATCH", url: API, postData: { mimeType: "application/json", text: JSON.stringify({ password }) } }, echoed)])).toThrow(new HarMaskError("secret_remains"));
  });

  test("Given unrelated Unicode-escaped JSON and unknown text, when masked, then both keep their original bytes", () => {
    const texts = [' { "echo" : "\\u0061" } ', 'unknown \\u0061 text'];
    const masked = mask(texts.map(text => entry({ url: API }, { content: { size: text.length, mimeType: "text/plain", text } })));
    expect(masked.entries.map(item => item.response.content.text)).toEqual(texts);
  });

  test("Given secret-named JSON body fields whose values hold a quote or a backslash, when masked, then the escaped values are masked in the request body and in a response that echoes them", () => {
    const masked = mask([entry({ method: "PATCH", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/json", text: JSON.stringify({ password: quoted, client_secret: backslashed }) } }, jsonBody({ data: { echo: `${quoted} ${backslashed}` } }))]);
    for (const part of ["quoted-pass-0123", "ss-word-back-0123"]) expect(masked.text).not.toContain(part);
    expect(JSON.parse(masked.entries[0]!.request.postData!.text)).toEqual({ password: MASKED, client_secret: MASKED });
    expect(JSON.parse(masked.entries[0]!.response.content.text).data).toEqual({ echo: `${MASKED} ${MASKED}` });
  });

  test("Given secrets that need JSON escaping echoed as JSON nested inside a JSON string, when masked, then the double-escaped values are masked", () => {
    const nested = JSON.stringify({ password: quoted, client_secret: backslashed });
    const masked = mask([entry({ method: "PATCH", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/json", text: nested } }, jsonBody({ data: { echo: nested } }))]);
    for (const part of ["quoted-pass-0123", "ss-word-back-0123"]) expect(masked.text).not.toContain(part);
    expect(JSON.parse(JSON.parse(masked.entries[0]!.response.content.text).data.echo)).toEqual({ password: MASKED, client_secret: MASKED });
  });

  test.each([2, 6])("Given a secret that needs JSON escaping nested %i levels deep inside a binary-typed base64 body, when masked, then masking fails closed with secret_remains", levels => {
    let echo: string = quoted;
    for (let level = 0; level < levels; level += 1) echo = JSON.stringify({ echo });
    const echoed = { content: { size: 40, mimeType: "application/octet-stream", encoding: "base64", text: Buffer.from(echo).toString("base64") } };
    expect(() => mask([entry({ method: "PATCH", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/json", text: JSON.stringify({ password: quoted }) } }, echoed)])).toThrow(new HarMaskError("secret_remains"));
  });

  test("Given a secret that needs JSON escaping nested deeper than masking unescapes inside a text body, when masked, then masking fails closed with secret_remains", () => {
    let echo: string = quoted;
    for (let level = 0; level < 8; level += 1) echo = JSON.stringify({ echo });
    expect(() => mask([entry({ method: "PATCH", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/json", text: JSON.stringify({ password: quoted }) } }, jsonBody({ data: echo }))])).toThrow(new HarMaskError("secret_remains"));
  });

  test("Given a secret that needs JSON escaping inside a binary-typed base64 body, when masked, then masking fails closed with secret_remains", () => {
    const echoed = { content: { size: 40, mimeType: "application/octet-stream", encoding: "base64", text: Buffer.from(JSON.stringify({ echo: quoted })).toString("base64") } };
    expect(() => mask([entry({ method: "PATCH", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/json", text: JSON.stringify({ password: quoted }) } }, echoed)])).toThrow(new HarMaskError("secret_remains"));
  });
});
