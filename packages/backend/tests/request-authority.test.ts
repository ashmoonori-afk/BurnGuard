import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  BURNGUARD_BOOTSTRAP_HEADER,
  BURNGUARD_CAPABILITY_HEADER,
  createRequestAuthority,
} from "../src/security/request-authority";
import { createApp } from "../src/server";
import { getSqlite } from "../src/db/sqlite-client";

const capability = "current-launch-capability";
const previousCapability = "previous-launch-capability";
const bootstrapSecret = "one-time-bootstrap-secret";

function createTestApp(options?: { dev?: boolean }) {
  let mutations = 0;
  const app = new Hono();
  app.use(
    "/api/*",
    createRequestAuthority({
      capability,
      bootstrapSecret,
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

  test("Given the one-time secret When the packaged app or explicit Vite authority bootstraps Then the capability is minted", async () => {
    const packagedApp = createTestApp().app;
    const viteApp = createTestApp({ dev: true }).app;
    const packaged = await packagedApp.request(
      request("/api/bootstrap", {
        headers: {
          origin: "http://127.0.0.1:14070",
          [BURNGUARD_BOOTSTRAP_HEADER]: bootstrapSecret,
        },
      }),
    );
    const vite = await viteApp.request(
      request("/api/bootstrap", {
        host: "127.0.0.1:5173",
        headers: {
          origin: "http://127.0.0.1:5173",
          [BURNGUARD_BOOTSTRAP_HEADER]: bootstrapSecret,
        },
      }),
    );

    expect(packaged.status).toBe(200);
    expect(vite.status).toBe(200);
    expect(packaged.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await packaged.json()).toEqual({
      ok: true,
      data: { capability },
    });
  });

  test("Given the one-time secret from a hostile origin When bootstrap is requested Then it is rejected and the secret stays unspent", async () => {
    const { app } = createTestApp();
    const hostile = await app.request(
      request("/api/bootstrap", {
        headers: {
          origin: "http://evil.test",
          [BURNGUARD_BOOTSTRAP_HEADER]: bootstrapSecret,
        },
      }),
    );
    const trusted = await app.request(
      request("/api/bootstrap", {
        headers: {
          origin: "http://127.0.0.1:14070",
          [BURNGUARD_BOOTSTRAP_HEADER]: bootstrapSecret,
        },
      }),
    );

    expect(hostile.status).toBe(403);
    expect(trusted.status).toBe(200);
  });

  test("Given a local client forging the app Origin without the secret When it requests bootstrap Then it gets 403 and no capability", async () => {
    const { app } = createTestApp();
    for (const supplied of [undefined, "wrong-secret", capability]) {
      const headers = new Headers({ origin: "http://127.0.0.1:14070" });
      if (supplied) headers.set(BURNGUARD_BOOTSTRAP_HEADER, supplied);
      const response = await app.request(request("/api/bootstrap", { headers }));

      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(JSON.stringify(await response.json())).not.toContain(capability);
    }
  });

  test("Given the secret was already spent When it is replayed Then bootstrap is rejected", async () => {
    const { app } = createTestApp();
    const bootstrap = () =>
      app.request(
        request("/api/bootstrap", {
          headers: {
            origin: "http://127.0.0.1:14070",
            [BURNGUARD_BOOTSTRAP_HEADER]: bootstrapSecret,
          },
        }),
      );

    expect((await bootstrap()).status).toBe(200);
    expect((await bootstrap()).status).toBe(403);
  });

  test("Given no bootstrap secret was configured When a forged Origin requests bootstrap Then it is rejected", async () => {
    const app = new Hono();
    app.use(
      "/api/*",
      createRequestAuthority({ capability, appAuthority: "127.0.0.1:14070" }),
    );
    const response = await app.request(
      request("/api/bootstrap", {
        headers: { origin: "http://127.0.0.1:14070" },
      }),
    );

    expect(response.status).toBe(403);
  });

  test("Given the launch cookie from the first bootstrap When the page reloads without the secret Then bootstrap succeeds again", async () => {
    const { app } = createTestApp();
    const first = await app.request(
      request("/api/bootstrap", {
        headers: {
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          [BURNGUARD_BOOTSTRAP_HEADER]: bootstrapSecret,
        },
      }),
    );
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const reload = await app.request(
      request("/api/bootstrap", {
        headers: {
          cookie,
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
      }),
    );
    const staleCookie = await app.request(
      request("/api/bootstrap", {
        headers: {
          cookie: `burnguard_capability=${previousCapability}`,
          origin: "http://127.0.0.1:14070",
        },
      }),
    );
    const crossSite = await app.request(
      request("/api/bootstrap", {
        headers: { cookie, origin: "http://evil.test" },
      }),
    );

    expect(first.status).toBe(200);
    expect(cookie).toBe(`burnguard_capability=${capability}`);
    expect(reload.status).toBe(200);
    expect(await reload.json()).toEqual({ ok: true, data: { capability } });
    expect(staleCookie.status).toBe(403);
    expect(crossSite.status).toBe(403);
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
