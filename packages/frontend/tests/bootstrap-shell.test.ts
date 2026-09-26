import { afterEach, describe, expect, mock, test } from "bun:test";
import { runBootstrap } from "../src/components/Bootstrap";
import { ApiError } from "../src/api/client";
import { useLocaleStore } from "../src/i18n/locale";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; useLocaleStore.getState().setLocale("ko"); });

function stubFetch(settings: () => Response): void {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/bootstrap") return Response.json({ data: { capability: "test" } });
    if (String(input) === "/api/settings") return settings();
    throw new Error(`unexpected ${String(input)}`);
  }) as typeof fetch;
}

describe("shell bootstrap (UX-13)", () => {
  test("Given bootstrap succeeds and the settings read fails When the shell boots Then it opens with the cached locale and reports the sync failure", async () => {
    stubFetch(() => Response.json({ error: { code: "settings_unavailable", message: "private" } }, { status: 500 }));
    useLocaleStore.getState().setLocale("en");
    const failures: unknown[] = [];

    await runBootstrap(new AbortController().signal, (error) => failures.push(error));

    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(ApiError);
    expect((failures[0] as ApiError).code).toBe("settings_unavailable");
    expect(useLocaleStore.getState().locale).toBe("en");
  });

  test("Given bootstrap succeeds and settings load When the shell boots Then the shared locale wins and nothing is reported", async () => {
    stubFetch(() => Response.json({ data: { locale: "zh-CN" } }));
    const failures: unknown[] = [];

    await runBootstrap(new AbortController().signal, (error) => failures.push(error));

    expect(failures).toEqual([]);
    expect(useLocaleStore.getState().locale).toBe("zh-CN");
  });

  test("Given bootstrap itself fails When the shell boots Then the failure propagates so the offline screen shows", async () => {
    globalThis.fetch = mock(async () => Response.json({ error: { code: "forbidden", message: "private" } }, { status: 403 })) as typeof fetch;
    const failures: unknown[] = [];

    await expect(runBootstrap(new AbortController().signal, (error) => failures.push(error))).rejects.toThrow();
    expect(failures).toEqual([]);
  });

  test("Given a raw fetch failure during the settings read When the shell boots Then it still opens and reports the failure", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/bootstrap") return Response.json({ data: { capability: "test" } });
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const failures: unknown[] = [];

    await runBootstrap(new AbortController().signal, (error) => failures.push(error));

    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(TypeError);
  });
});
