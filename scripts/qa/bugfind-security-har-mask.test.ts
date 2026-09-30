import { describe, expect, test } from "bun:test";
import { HarMaskError, maskHar } from "./har-mask";

const CAPABILITY = "c4p4b1l1tyV4lu3-0123456789abcdef";
const entry = (request: Record<string, unknown>, response: Record<string, unknown>) => ({ startedDateTime: "2026-09-30T01:00:00.000Z", time: 5, request: { method: "GET", httpVersion: "HTTP/1.1", headers: [], cookies: [], queryString: [], ...request }, response: { status: 200, statusText: "OK", httpVersion: "HTTP/1.1", headers: [], cookies: [], content: { size: 0, mimeType: "application/json", text: "" }, ...response } });
const bootstrap = () => entry({ url: "http://127.0.0.1:14070/api/bootstrap" }, { content: { size: 60, mimeType: "application/json", text: JSON.stringify({ ok: true, data: { capability: CAPABILITY } }) } });

describe("bugfind: HAR masking of caller-given roots and collected secrets", () => {
  test("Given a Windows QA root passed with --root When a JSON response body carries a path under it Then the masked HAR no longer contains the root", () => {
    // Given: a QA home outside C:\Users (so no home pattern applies) and a JSON body that mentions it, JSON-escaped as on the wire.
    const root = "D:\\bg-qa\\run-42";
    const har = { log: { entries: [bootstrap(), entry({ url: "http://127.0.0.1:14070/api/projects" }, { content: { size: 80, mimeType: "application/json", text: JSON.stringify({ data: { dir_path: `${root}\\projects\\p1` } }) } })] } };

    // When: the HAR is masked with that root.
    const text = JSON.stringify(maskHar(har, [{ path: root, placeholder: "<qa-home>" }]).har);

    // Then: neither the raw nor the JSON-escaped form survives.
    expect(text).not.toContain("bg-qa");
  });

  test("Given a POSIX QA root passed with --root When a request URL carries it percent-encoded Then the masked HAR no longer contains the root", () => {
    // Given: the root appears URL-encoded in a query string, the same way HOME_PATTERNS already handles %2Fhome%2F.
    const root = "/tmp/qa-home-77";
    const har = { log: { entries: [bootstrap(), entry({ url: `http://127.0.0.1:14070/api/projects?dir=${encodeURIComponent(`${root}/projects`)}`, queryString: [{ name: "dir", value: `${root}/projects` }] }, {})] } };

    // When
    const text = JSON.stringify(maskHar(har, [{ path: root, placeholder: "<qa-home>" }]).har);

    // Then
    expect(text).not.toContain("qa-home-77");
  });

  test("Given a secret-named JSON body field whose value needs JSON escaping When masked Then the secret is masked or masking fails closed", () => {
    // Given: a settings request whose password value contains a quote, so the body text holds it escaped.
    const password = "hunter2\"quoted-pass-0123";
    const har = { log: { entries: [bootstrap(), entry({ method: "PATCH", url: "http://127.0.0.1:14070/api/settings", postData: { mimeType: "application/json", text: JSON.stringify({ password }) } }, {})] } };

    // When
    let text = "";
    let error: unknown = null;
    try { text = JSON.stringify(maskHar(har).har); } catch (caught) { error = caught; }

    // Then: either the distinctive part of the secret is gone, or the tool refused with secret_remains.
    if (error !== null) { expect(error).toEqual(new HarMaskError("secret_remains")); return; }
    expect(text).not.toContain("quoted-pass-0123");
  });
});
