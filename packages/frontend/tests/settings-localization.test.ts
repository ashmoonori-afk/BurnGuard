import { afterEach, expect, test } from "bun:test";
import type { AppUpdateStatus } from "@bg/shared";
import { LOCALES, useLocaleStore } from "@/i18n/locale";
import { t } from "@/i18n/t";
import { apiErrorCopy } from "@/lib/error-copy";
import { appUpdateView } from "@/lib/app-update-state";

afterEach(() => useLocaleStore.getState().setLocale("ko"));

test("error helpers resolve the selected locale at call time and never expose internal messages", () => {
  for (const locale of LOCALES) {
    useLocaleStore.getState().setLocale(locale);
    expect(apiErrorCopy({ code: "invalid_llm_api_keys", message: "private-key-sentinel" })).toBe(t("errors.invalid_llm_api_keys"));
    for (const code of ["unmapped", "toString", "constructor", "__proto__"]) {
      expect(apiErrorCopy({ code, message: "private-key-sentinel" })).toBe(t("errors.fallback"));
    }
  }
});

test("update helpers translate at call time without changing status actions or version identifiers", () => {
  const status: AppUpdateStatus = {
    supported: true, unsupported_reason: null, state: "ready", current_version: "1.0.0",
    available_version: "2.3.4-preview", progress: null, checked_at: 1, error: null,
  };
  for (const locale of LOCALES) {
    useLocaleStore.getState().setLocale(locale);
    expect(appUpdateView(status)).toEqual({
      visible: true, canApply: true, canCheck: true, busy: false,
      label: t("settings.updateReady", { version: "2.3.4-preview" }),
    });
    expect(appUpdateView({ ...status, state: "downloading", progress: 42 }).label)
      .toBe(t("settings.updateDownloading", { progress: 42 }));
  }
});
