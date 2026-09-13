import { describe, expect, test } from "bun:test";
import {
  loadNetworkResearchSource,
  ResearchSourceLoadError,
  type ResearchTransport,
} from "../src/services/research-source-loader";

const source = {
  id: "research-source",
  ordinal: 0,
  kind: "web",
  locator: "https://research.example/source.json",
  canonicalLocator: "https://research.example/source.json",
} as const;

describe("research source network boundary", () => {
  test("resolves and pins a public address before requesting an untrusted source", async () => {
    const requested: URL[] = [];
    const request: ResearchTransport = async (url, init) => {
      requested.push(new URL(url));
      expect(new Headers(init.headers).get("host")).toBe("research.example");
      expect(init.tls?.serverName).toBe("research.example");
      return Response.json({
        schema_version: 1,
        title: "Pinned research",
        claims: [{ axis: "layout", text: "Use a clear hierarchy." }],
      });
    };

    const result = await loadNetworkResearchSource(
      { source, maxBytes: 4096, request },
      new AbortController().signal,
      {
        resolveAddresses: async () => [
          { address: "93.184.216.34", family: 4 },
        ],
      },
    );

    expect(requested.map((url) => url.hostname)).toEqual(["93.184.216.34"]);
    expect(result.finalUrl).toBe(source.canonicalLocator);
  });

  test("keeps resolver diagnostics out of research failure state", async () => {
    let requestCalls = 0;
    const promise = loadNetworkResearchSource(
      {
        source,
        maxBytes: 4096,
        request: async () => {
          requestCalls += 1;
          throw new Error("request must not run");
        },
      },
      new AbortController().signal,
      {
        resolveAddresses: async () => {
          throw new Error(
            "resolver failed with secret at /Users/local/private.conf",
          );
        },
      },
    );

    const rejection = await promise.catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ResearchSourceLoadError);
    if (!(rejection instanceof ResearchSourceLoadError)) {
      throw new Error("expected typed research source failure");
    }
    expect(rejection.code).toBe("fetch_failed");
    expect(rejection.message.length).toBeLessThan(128);
    expect(rejection.message).not.toContain("/Users/local");
    expect(requestCalls).toBe(0);
  });
});
