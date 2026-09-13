import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  BURNGUARD_CAPABILITY_HEADER,
  createRequestAuthority,
} from "../src/security/request-authority";
import { createApp } from "../src/server";
import { getSqlite } from "../src/db/sqlite-client";

const capability = "current-launch-capability";
const previousCapability = "previous-launch-capability";

function createTestApp(options?: { dev?: boolean }) {
  let mutations = 0;
  const app = new Hono();
  app.use(
    "/api/*",
    createRequestAuthority({
      capability,
      appAuthority: "127.0.0.1:14070",
      devAuthority: options?.dev ? "127.0.0.1:5173" : undefined,
    }),
  );
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/private", (c) => c.json({ ok: true }));
  app.post("/api/mutate", (c) => {
    mutations += 1;
    return c.json({ ok: true });
  });
  return { app, mutationCount: () => mutations };
}

function request(
  path: string,
  init: RequestInit & { host?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("host", init.host ?? "127.0.0.1:14070");
  return new Request(`http://127.0.0.1:14070${path}`, {
    ...init,
    headers,
  });
}

describe("request authority", () => {
  test("allows public health only on the configured authority", async () => {
    const { app } = createTestApp();

    expect((await app.request(request("/api/health"))).status).toBe(200);
    expect(
      (
        await app.request(
          request("/api/health", { host: "127.0.0.1.evil:14070" }),
        )
      ).status,
    ).toBe(421);
  });

  test("rejects absent, wrong, and previous-launch capabilities without mutation", async () => {
    const { app, mutationCount } = createTestApp();
    const baseHeaders = { origin: "http://127.0.0.1:14070" };

    for (const supplied of [undefined, "wrong", previousCapability]) {
      const headers = new Headers(baseHeaders);
      if (supplied) headers.set(BURNGUARD_CAPABILITY_HEADER, supplied);
      const response = await app.request(
        request("/api/mutate", { method: "POST", headers }),
      );
      expect(response.status).toBe(403);
    }
    expect(mutationCount()).toBe(0);
  });

  test("rejects hostile origins and simple browser mutations without side effects", async () => {
    const { app, mutationCount } = createTestApp();
    const response = await app.request(
      request("/api/mutate", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          origin: "http://evil.test",
          [BURNGUARD_CAPABILITY_HEADER]: capability,
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(mutationCount()).toBe(0);
  });

  test("allows an authorized same-origin mutation", async () => {
    const { app, mutationCount } = createTestApp();
    const response = await app.request(
      request("/api/mutate", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:14070",
          [BURNGUARD_CAPABILITY_HEADER]: capability,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mutationCount()).toBe(1);
  });

  test("allows private GET and SSE channels through a launch-scoped cookie", async () => {
    const { app } = createTestApp();
    const response = await app.request(
      request("/api/private", {
        headers: { cookie: `burnguard_capability=${capability}` },
      }),
    );

    expect(response.status).toBe(200);
  });

  test("bootstraps only the packaged app or explicit Vite authority", async () => {
    const { app } = createTestApp({ dev: true });
    const packaged = await app.request(
      request("/api/bootstrap", {
        headers: { origin: "http://127.0.0.1:14070" },
      }),
    );
    const vite = await app.request(
      request("/api/bootstrap", {
        host: "127.0.0.1:5173",
        headers: { origin: "http://127.0.0.1:5173" },
      }),
    );
    const hostile = await app.request(
      request("/api/bootstrap", {
        headers: { origin: "http://evil.test" },
      }),
    );

    expect(packaged.status).toBe(200);
    expect(vite.status).toBe(200);
    expect(hostile.status).toBe(403);
    expect(packaged.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await packaged.json()).toEqual({
      ok: true,
      data: { capability },
    });
  });

  test("accepts a browser same-origin bootstrap without an Origin header", async () => {
    const { app } = createTestApp();
    const response = await app.request(
      request("/api/bootstrap", {
        headers: {
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  test("answers only trusted preflights", async () => {
    const { app } = createTestApp({ dev: true });
    const allowed = await app.request(
      request("/api/mutate", {
        host: "127.0.0.1:5173",
        method: "OPTIONS",
        headers: {
          origin: "http://127.0.0.1:5173",
          "access-control-request-method": "POST",
          "access-control-request-headers": BURNGUARD_CAPABILITY_HEADER,
        },
      }),
    );
    const hostile = await app.request(
      request("/api/mutate", {
        method: "OPTIONS",
        headers: {
          origin: "http://evil.test",
          "access-control-request-method": "POST",
        },
      }),
    );

    expect(allowed.status).toBe(204);
    expect(hostile.status).toBe(403);
  });

  test("guards the real route tree before routing", async () => {
    const app = createApp({
      capability,
      appAuthority: "127.0.0.1:14070",
    });

    expect((await app.request(request("/api/health"))).status).toBe(200);
    expect((await app.request(request("/api/does-not-exist"))).status).toBe(
      403,
    );
    expect(
      (
        await app.request(
          request("/api/does-not-exist", {
            headers: { [BURNGUARD_CAPABILITY_HEADER]: capability },
          }),
        )
      ).status,
    ).toBe(404);
  });

  test("marks private JSON responses as non-storable and non-sniffable", async () => {
    const app = createApp({
      capability,
      appAuthority: "127.0.0.1:14070",
    });
    const authorized = await app.request(
      request("/api/settings", {
        headers: {
          cookie: `burnguard_capability=${capability}`,
        },
      }),
    );
    const denied = await app.request(request("/api/settings"));

    for (const response of [authorized, denied]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  test("marks authorized SSE responses as non-storable and non-sniffable", async () => {
    const db = getSqlite();
    db.prepare(
      "INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('header-project','Header project','prototype','/tmp/header-project','index.html','codex',1,1)",
    ).run();
    db.prepare(
      "INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('header-session','header-project','codex','idle',1,1,1)",
    ).run();
    try {
      const response = await createApp({
        capability,
        appAuthority: "127.0.0.1:14070",
      }).request(
        request("/api/sessions/header-session/stream", {
          headers: {
            cookie: `burnguard_capability=${capability}`,
          },
        }),
      );

      expect(response.headers.get("content-type")).toStartWith(
        "text/event-stream",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      await response.body?.cancel();
    } finally {
      db.prepare("DELETE FROM sessions WHERE id='header-session'").run();
      db.prepare("DELETE FROM projects WHERE id='header-project'").run();
    }
  });
});
