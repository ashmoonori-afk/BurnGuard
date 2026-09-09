import { describe, expect, test } from "bun:test";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";

const BASE_HREF = "http://127.0.0.1:14070/api/projects/p/fs/index.html";

function metaPolicy(srcDoc: string): Map<string, string[]> {
  const content = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/u.exec(srcDoc)?.[1] ?? null;
  const out = new Map<string, string[]>();
  for (const part of (content ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe("sandboxed artifact policy", () => {
  test("Given an artifact with a head When sandboxed Then the CSP meta precedes the base tag and confines network to the app origin", () => {
    const srcDoc = buildSandboxedArtifactSrcDoc("<html><head><title>t</title></head><body>x</body></html>", BASE_HREF);
    const policy = metaPolicy(srcDoc);
    expect(policy.get("connect-src")).toEqual(["http://127.0.0.1:14070"]);
    expect(policy.get("form-action")).toEqual(["'none'"]);
    expect(policy.get("frame-src")).toEqual(["https://www.google.com/maps/embed", "https://www.google.com/maps/embed/"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["http://127.0.0.1:14070"]);
    expect(srcDoc.indexOf("Content-Security-Policy")).toBeLessThan(srcDoc.indexOf("<base href"));
  });

  test("Given a bare fragment When sandboxed Then the generated head still carries the CSP meta", () => {
    const policy = metaPolicy(buildSandboxedArtifactSrcDoc("<p>fragment</p>", BASE_HREF));
    expect(policy.get("connect-src")).toEqual(["http://127.0.0.1:14070"]);
  });
});
