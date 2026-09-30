import { describe, expect, test } from "bun:test";
import { apiErrorCopy } from "../src/lib/error-copy";
import { useLocaleStore } from "../src/i18n/locale";
import { messages } from "../src/i18n/messages";
import { t } from "../src/i18n/t";

// Codes emitted by packages/backend/src/routes/settings.ts and the settings PATCH branch of home.ts,
// each surfaced in Settings through apiErrorCopy(error).
const SETTINGS_ERROR_CODES = [
  "local_fonts_unavailable",
  "bundled_fonts_unavailable",
  "update_unsupported",
  "update_not_ready",
  "install_in_progress",
  "python_not_found",
  "invalid_locale",
  "invalid_theme",
] as const;

describe("settings and i18n bugfind repros", () => {
  test("Given a Settings backend error code When apiErrorCopy maps it Then it is not the generic fallback", () => {
    useLocaleStore.getState().setLocale("en");
    const fallback = t("errors.fallback");
    const generic = SETTINGS_ERROR_CODES.filter((code) => apiErrorCopy({ code }) === fallback);
    expect(generic).toEqual([]);
  });

  test("Given the shell tagline When read for every locale Then ko is translated rather than the English copy", () => {
    const entry = messages["shell.tagline"];
    expect(entry.ko).not.toBe(entry.en);
  });

  test("Given a numeric artifact revision above 999 When interpolated into the source line Then it has no digit grouping", () => {
    useLocaleStore.getState().setLocale("en");
    const rendered = t("modes.ux.source", { path: "index.html", revision: 1234 });
    expect(rendered).toContain("1234");
    expect(rendered).not.toContain("1,234");
  });
});
