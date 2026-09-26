import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { persistLocale } from "../src/components/settings/SettingsModal";
import { ApiError, bootstrapApiAuthority } from "../src/api/client";
import { synchronizePortableLocale, useLocaleStore } from "../src/i18n/locale";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; useLocaleStore.getState().setLocale("ko"); });

describe("language choice persistence (UX-07)", () => {
  test("Given profile locale ko When en is selected and the dialog closes without Save Then the PATCH already carried en and a later sync keeps it", async () => {
    const patches: unknown[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/bootstrap") return Response.json({ data: { capability: "test" } });
      expect(String(input)).toBe("/api/settings");
      expect(init?.method).toBe("PATCH");
      patches.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { locale: "en", theme: "light" } });
    }) as typeof fetch;
    await bootstrapApiAuthority();
    const client = new QueryClient();

    await persistLocale("en", client);

    expect(patches).toEqual([{ locale: "en" }]);
    expect(useLocaleStore.getState().locale).toBe("en");
    expect(client.getQueryData(["settings"])).toEqual({ locale: "en", theme: "light" });

    await synchronizePortableLocale(async () => ({ locale: "en" }), async () => { throw new Error("must not republish"); });
    expect(useLocaleStore.getState().locale).toBe("en");
  });

  test("Given the profile save fails When a language is selected Then the choice still applies locally and the failure surfaces to the caller", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => String(input) === "/api/bootstrap"
      ? Response.json({ data: { capability: "test" } })
      : Response.json({ error: { code: "forbidden", message: "private" } }, { status: 403 })) as typeof fetch;
    await bootstrapApiAuthority();
    const client = new QueryClient();

    await expect(persistLocale("zh-CN", client)).rejects.toBeInstanceOf(ApiError);
    expect(useLocaleStore.getState().locale).toBe("zh-CN");
    expect(client.getQueryData(["settings"])).toBeUndefined();
  });
});
