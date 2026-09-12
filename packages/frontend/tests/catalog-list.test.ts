import { afterEach, expect, spyOn, test } from "bun:test";
import { bootstrapApiAuthority } from "../src/api/client";
import { listDesignSystems } from "../src/api/home";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("browser catalogs omit trash for every publication status", async () => {
  const systems = ["draft", "review", "published"].flatMap((status) => [
    { id: `${status}-active`, status, lifecycle: "active" },
    { id: `${status}-trashed`, status, lifecycle: "trashed" },
  ]);
  spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://catalog.test");
    if (url.pathname === "/api/bootstrap") return Response.json({ data: { capability: "fixture-capability" } });
    const lifecycle = url.searchParams.get("lifecycle");
    return Response.json({
      data: systems.filter((system) => system.status === url.searchParams.get("status")
        && (lifecycle === null || system.lifecycle === lifecycle)),
    });
  });
  await bootstrapApiAuthority();
  for (const status of ["draft", "review", "published"] as const) {
    expect((await listDesignSystems(status)).map((system) => system.id)).toEqual([`${status}-active`]);
  }
});
