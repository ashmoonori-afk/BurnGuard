import { afterEach, expect, mock, test } from "bun:test";
import { ApiError, apiFetch, bootstrapApiAuthority, onAuthorityRejected } from "../src/api/client";
import { announceBackendRestart } from "../src/components/Bootstrap";
import { t } from "../src/i18n/t";
import { useUIStore } from "../src/state/uiStore";

const originalFetch = globalThis.fetch;

async function withBackend(status: number, body: unknown): Promise<void> {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => String(input) === "/api/bootstrap"
    ? Response.json({ data: { capability: "old-launch" } })
    : Response.json(body, { status })) as typeof fetch;
  await bootstrapApiAuthority();
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  useUIStore.setState({ toasts: [] });
});

test("Given a restarted backend rejects the old capability When any API call answers 403 forbidden Then listeners hear it once and the call still fails with the typed error", async () => {
  await withBackend(403, { error: { code: "forbidden", message: "Request authority rejected." } });
  const heard: string[] = [];
  const stop = onAuthorityRejected(() => heard.push("rejected"));
  const failure = await apiFetch("/api/projects").catch((error: unknown) => error);
  stop();
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).code).toBe("forbidden");
  expect(heard).toEqual(["rejected"]);
});

test("Given a 403 that is a domain refusal or a listener that unsubscribed When the call fails Then no restart is reported", async () => {
  await withBackend(403, { error: { code: "protected_seed", message: "x" } });
  const heard: string[] = [];
  const stop = onAuthorityRejected(() => heard.push("rejected"));
  await apiFetch("/api/learning").catch(() => undefined);
  stop();
  await withBackend(403, { error: { code: "forbidden", message: "x" } });
  await apiFetch("/api/projects").catch(() => undefined);
  expect(heard).toEqual([]);
});

test("Given repeated rejections When the restart notice is announced Then one persistent error toast offers Reload and its action reloads", () => {
  let reloads = 0;
  announceBackendRestart(() => { reloads += 1; });
  announceBackendRestart(() => { reloads += 1; });
  const toasts = useUIStore.getState().toasts;
  expect(toasts).toHaveLength(1);
  expect(toasts[0]?.tone).toBe("error");
  expect(toasts[0]?.title).toBe(t("errors.forbidden"));
  expect(toasts[0]?.action?.label).toBe(t("shell.reload"));
  toasts[0]?.action?.onSelect();
  expect(reloads).toBe(1);
});
