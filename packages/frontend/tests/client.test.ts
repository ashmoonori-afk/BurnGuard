import { afterEach, describe, expect, mock, test } from "bun:test";
import type { UpdateDesignSystemRequest } from "@bg/shared";
import {
  apiFetch,
  authorizedFetch,
  bootstrapApiAuthority,
} from "../src/api/client";
import { catalogDetailRows, getDesignSystem, updateDesignSystemWithConflictReload } from "../src/api/design-system-metadata";
import { deleteProject } from "../src/api/home";

const originalFetch = globalThis.fetch;

function catalogDetail(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    id: "system-id", name: "Current", description: null, status: "review", source_type: "github",
    source_uri: "https://example.test/source", dir_path: "/catalog/system-id", skill_md_path: "/catalog/system-id/SKILL.md",
    tokens_css_path: "/catalog/system-id/colors_and_type.css", readme_md_path: "/catalog/system-id/README.md", archived_at: null,
    is_template: false, thumbnail_path: null, kind: "design-system", owner: "local", lifecycle: "active",
    provenance: "observed", license: "verified", tags: ["brand"], metadata_revision: 8,
    content: { revision: 1, receipt_id: "receipt-id", digest: "digest" }, lineage: null,
    preview: { path: "README.md", fallback: false }, usage: [], warning: null, created_at: 1, updated_at: 2,
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("API authority client", () => {
  test("bootstraps in memory and attaches the capability to API requests", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input: String(input), init });
        if (String(input) === "/api/bootstrap") {
          return Response.json({
            ok: true,
            data: { capability: "launch-token" },
          });
        }
        return Response.json({ ok: true, data: { saved: true } });
      },
    ) as typeof fetch;

    await bootstrapApiAuthority();
    await apiFetch<{ saved: true }>("/api/mutate", { method: "POST" });

    expect(calls).toHaveLength(2);
    const headers = new Headers(calls[1]?.init?.headers);
    expect(headers.get("x-burnguard-capability")).toBe("launch-token");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    expect(calls[1]?.init?.credentials).toBe("same-origin");
  });

  test("fails closed when bootstrap does not return a capability", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ ok: true, data: {} }),
    ) as typeof fetch;

    await expect(bootstrapApiAuthority()).rejects.toThrow(
      "BurnGuard API authority bootstrap failed.",
    );
  });

  test("rejects malformed bootstrap and API JSON at their boundaries", async () => {
    globalThis.fetch = mock(async () => new Response("not-json", { status: 502, statusText: "Bad Gateway" })) as typeof fetch;
    await expect(bootstrapApiAuthority()).rejects.toThrow("BurnGuard API authority bootstrap failed.");

    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      if (calls === 1) return Response.json({ ok: true, data: { capability: "launch-token" } });
      return new Response("not-json", { status: 502, statusText: "Bad Gateway" });
    }) as typeof fetch;
    await bootstrapApiAuthority();
    await expect(apiFetch("/api/private")).rejects.toMatchObject({ code: "network_error", status: 502 });
  });

  test("cannot reuse a previous capability after bootstrap fails", async () => {
    let bootstrapCalls = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input) !== "/api/bootstrap") {
        return Response.json({ ok: true, data: {} });
      }
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) {
        return Response.json({
          ok: true,
          data: { capability: "stale-token" },
        });
      }
      return Response.json(
        { error: { code: "forbidden", message: "denied" } },
        { status: 403 },
      );
    }) as typeof fetch;

    await bootstrapApiAuthority();
    await expect(bootstrapApiAuthority()).rejects.toThrow();
    await expect(apiFetch("/api/private")).rejects.toThrow(
      "BurnGuard API authority is not initialized.",
    );
  });

  test("rejects a catalog detail response that omits runtime detail fields", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/bootstrap") return Response.json({ ok: true, data: { capability: "launch-token" } });
      return Response.json({ ok: true, data: { id: "system-id", name: "Incomplete" } });
    }) as typeof fetch;

    await bootstrapApiAuthority();

    await expect(getDesignSystem("system-id")).rejects.toThrow("Invalid catalog design-system detail");
  });

  test("parses and displays truthful source path and archive detail fields", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/bootstrap") return Response.json({ ok: true, data: { capability: "launch-token" } });
      return Response.json({ ok: true, data: catalogDetail({ archived_at: 123 }) });
    }) as typeof fetch;

    await bootstrapApiAuthority();
    const system = await getDesignSystem("system-id");

    expect(system).toMatchObject({ source_type: "github", source_uri: "https://example.test/source", dir_path: "/catalog/system-id", skill_md_path: "/catalog/system-id/SKILL.md", tokens_css_path: "/catalog/system-id/colors_and_type.css", readme_md_path: "/catalog/system-id/README.md", archived_at: 123 });
    expect(Object.fromEntries(catalogDetailRows(system).map((row) => [row.label, row.value]))).toMatchObject({ Source: "github", "Source URI": "https://example.test/source", Directory: "/catalog/system-id", "SKILL.md": "/catalog/system-id/SKILL.md", "Tokens CSS": "/catalog/system-id/colors_and_type.css", "README.md": "/catalog/system-id/README.md", Archived: "123" });
  });

  test("sends strict metadata CAS fields through the successful editor flow", async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      if (String(input) === "/api/bootstrap") return Response.json({ ok: true, data: { capability: "launch-token" } });
      return Response.json({ ok: true, data: catalogDetail() });
    }) as typeof fetch;
    const patch = { expected_revision: 7, name: "Current", description: null, status: "review", tags: ["brand"] } satisfies UpdateDesignSystemRequest;

    await bootstrapApiAuthority();
    const result = await updateDesignSystemWithConflictReload("system-id", patch);

    expect(result).toMatchObject({ kind: "updated", system: { id: "system-id", metadata_revision: 8, status: "review" } });
    expect(JSON.parse(String(calls[1]?.body))).toEqual(patch);
  });

  test("sends strict metadata CAS fields and reloads a stale conflict", async () => {
    const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      if (String(input) === "/api/bootstrap") return Response.json({ ok: true, data: { capability: "launch-token" } });
      if (init?.method === "PATCH") return Response.json({ error: { code: "expected_revision_conflict", message: "stale" } }, { status: 412 });
      return Response.json({ ok: true, data: catalogDetail({ name: "Winner" }) });
    }) as typeof fetch;
    const patch = {
      expected_revision: 7,
      name: "Current",
      description: null,
      status: "review",
      tags: ["brand"],
    } satisfies UpdateDesignSystemRequest;

    await bootstrapApiAuthority();
    const result = await updateDesignSystemWithConflictReload("system-id", patch);

    expect(result).toMatchObject({ kind: "conflict", current: { id: "system-id", metadata_revision: 8, name: "Winner" } });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(patch);
    expect(calls.map((call) => [call.input, call.init?.method ?? "GET"])).toEqual([
      ["/api/bootstrap", "GET"],
      ["/api/design-systems/system-id", "PATCH"],
      ["/api/design-systems/system-id", "GET"],
    ]);
  });

  test("treats a 204 as an empty success and still sends the capability", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      if (String(input) === "/api/bootstrap") return Response.json({ ok: true, data: { capability: "launch-token" } });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await bootstrapApiAuthority();
    await expect(deleteProject("project-1")).resolves.toBeUndefined();

    expect(calls[1]?.input).toBe("/api/projects/project-1");
    expect(calls[1]?.init?.method).toBe("DELETE");
    expect(new Headers(calls[1]?.init?.headers).get("x-burnguard-capability")).toBe("launch-token");
  });

  test("keeps the capability when callers supply additional headers", async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init ?? {});
        if (String(input) === "/api/bootstrap") {
          return Response.json({
            ok: true,
            data: { capability: "launch-token" },
          });
        }
        return Response.json({ ok: true, data: {} });
      },
    ) as typeof fetch;

    await bootstrapApiAuthority();
    await apiFetch("/api/private", {
      headers: { "x-extra": "kept" },
    });

    const headers = new Headers(calls[1]?.headers);
    expect(headers.get("x-burnguard-capability")).toBe("launch-token");
    expect(headers.get("x-extra")).toBe("kept");
  });

  test("never sends the launch capability to a cross-origin URL", async () => {
    const calls: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("http://127.0.0.1:14070/projects/example"),
    });
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({ ok: true, data: { capability: "launch-token" } });
    }) as typeof fetch;

    try {
      await bootstrapApiAuthority();
      await expect(
        authorizedFetch("http://127.0.0.1:14070/api/private"),
      ).resolves.toBeInstanceOf(Response);
      await expect(
        authorizedFetch("https://attacker.invalid/collect"),
      ).rejects.toThrow("BurnGuard API requests must stay on the app origin.");
      expect(calls).toEqual([
        "/api/bootstrap",
        "http://127.0.0.1:14070/api/private",
      ]);
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, "location");
      } else {
        Object.defineProperty(globalThis, "location", descriptor);
      }
    }
  });
});
