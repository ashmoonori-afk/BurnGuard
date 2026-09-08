import { describe, expect, test } from "bun:test";
import { createApp } from "../src/server";
import { isBurnGuardHealth, probePort } from "../../../scripts/dev-launcher";

describe("launcher readiness", () => {
  test("Given capability-protected BurnGuard When probed without credentials Then public health identifies the running app", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 503 }) });
    const origin = `http://127.0.0.1:${server.port}`;
    const app = createApp({ capability: "launcher-fixture", appAuthority: `127.0.0.1:${server.port}` });
    server.reload({ fetch: app.fetch });
    try {
      expect((await fetch(`${origin}/api/projects`)).status).toBe(403);
      expect(await probePort(`${origin}/api/health`)).toBe("burnguard");
    } finally {
      await server.stop(true);
    }
  });

  test("Given an unrelated HTTP service When its health returns success Then it is not classified as BurnGuard", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ ok: true, name: "other" }) });
    const url = `http://127.0.0.1:${server.port}/api/health`;
    try {
      expect(await probePort(url)).toBe("other");
    } finally {
      await server.stop(true);
    }
    expect(await probePort(url)).toBe("free");
    expect(await isBurnGuardHealth(new Response("forbidden", { status: 403 }))).toBe(false);
    expect(await isBurnGuardHealth(new Response("<html>not ready</html>"))).toBe(false);
  });
});
