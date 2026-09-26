import { afterEach, expect, mock, test } from "bun:test";
import { bootstrapApiAuthority } from "../src/api/client";
import { getProjectDraws } from "../src/api/draws";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("Given a stored capability When saved draws are read Then the request carries the capability header and same-origin credentials (UXW-30)", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/bootstrap") return Response.json({ data: { capability: "draw-token" } });
    requests.push({ url: String(input), init });
    return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
  }) as typeof fetch;
  await bootstrapApiAuthority();
  expect(await getProjectDraws("project", "pages/index.html")).toBe("<svg/>");
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe("/api/projects/project/draws/pages/index.html");
  expect(new Headers(requests[0]!.init?.headers).get("x-burnguard-capability")).toBe("draw-token");
  expect(requests[0]!.init?.credentials).toBe("same-origin");
});
