import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CodexProgressMetricsToggle, { codexProgressMetricsPatch } from "../src/components/settings/CodexProgressMetricsToggle";
import { t } from "../src/i18n/t";
import { LOCALES } from "../src/i18n/locale";
import { settingsMessages } from "../src/i18n/messages/settings";
import { mockSettings } from "../src/mocks/home-fixtures";

const render = (checked: boolean, userOtelConfigured: boolean) => renderToStaticMarkup(createElement(CodexProgressMetricsToggle, { checked, userOtelConfigured, onChange() {} }));
const toggle = (html: string) => html.match(/<input[^>]*role="switch"[^>]*>/)?.[0] ?? "";
const note = (html: string) => html.match(/<p[^>]*role="note"[^>]*data-bg-codex-progress-note="user-otel"[^>]*>([^<]*)<\/p>/)?.[1];
const source = await Bun.file(new URL("../src/components/settings/SettingsModal.tsx", import.meta.url)).text();

describe("Codex progress metrics toggle", () => {
  test("Given the default with no user OTel destination When Settings renders Then the switch is checked with its description and no note", () => {
    const html = render(true, false);
    expect(toggle(html)).toContain('data-bg-setting="codex_progress_metrics"');
    expect(toggle(html)).toContain('aria-checked="true"');
    expect(toggle(html)).toContain('checked=""');
    expect(html).toContain(t("settings.codexProgressMetrics"));
    expect(html).toContain(t("settings.codexProgressMetricsHint"));
    expect(html).not.toContain('role="note"');
  });

  test("Given a user OTel destination When Settings renders Then the switch is unchecked and the note is shown", () => {
    const html = render(false, true);
    expect(toggle(html)).toContain('aria-checked="false"');
    expect(toggle(html)).not.toContain('checked=""');
    expect(note(html)).toBe(t("settings.codexProgressMetricsUserOtel"));
  });

  test("Given a user OTel destination and the user turned the switch on When Settings renders Then it is checked and the note stays", () => {
    const html = render(true, true);
    expect(toggle(html)).toContain('aria-checked="true"');
    expect(note(html)).toBe(t("settings.codexProgressMetricsUserOtel"));
  });

  test("Given the Settings dialog When saved Then the toggle sits beside the provider settings and only a changed value becomes an explicit choice", () => {
    expect(source.indexOf("<CodexProgressMetricsToggle")).toBeGreaterThan(source.indexOf('t("settings.webAssetSearchHint")'));
    expect(source.indexOf("<CodexProgressMetricsToggle")).toBeLessThan(source.indexOf('id="commandcode-api-key"'));
    expect(source).toContain("userOtelConfigured={settings.codex_user_otel_configured}");
    expect(source).toContain("...codexProgressMetricsPatch(settingsQuery.data, settings.codex_progress_metrics),");
    const loaded = { ...mockSettings, codex_progress_metrics: true };
    expect(codexProgressMetricsPatch(loaded, true)).toEqual({});
    expect(codexProgressMetricsPatch(loaded, false)).toEqual({ codex_progress_metrics: false });
    expect(codexProgressMetricsPatch({ ...loaded, codex_progress_metrics: false, codex_user_otel_configured: true }, true)).toEqual({ codex_progress_metrics: true });
  });

  test("Given every locale When the toggle copy is resolved Then each key has copy", () => {
    for (const key of ["settings.codexProgressMetrics", "settings.codexProgressMetricsHint", "settings.codexProgressMetricsUserOtel"] as const) {
      for (const locale of LOCALES) expect(settingsMessages[key][locale].length, `${key}/${locale}`).toBeGreaterThan(0);
    }
  });
});
