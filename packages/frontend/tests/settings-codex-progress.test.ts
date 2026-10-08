import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CodexProgressMetricsToggle from "../src/components/settings/CodexProgressMetricsToggle";
import { t } from "../src/i18n/t";
import { LOCALES } from "../src/i18n/locale";
import { settingsMessages } from "../src/i18n/messages/settings";

const render = (checked: boolean) => renderToStaticMarkup(createElement(CodexProgressMetricsToggle, { checked, onChange() {} }));
const toggle = (html: string) => html.match(/<input[^>]*role="switch"[^>]*>/)?.[0] ?? "";
const source = await Bun.file(new URL("../src/components/settings/SettingsModal.tsx", import.meta.url)).text();

describe("Codex progress metrics toggle", () => {
  test("Given the setting off When Settings renders Then an unchecked switch with its description shows and the on-note does not", () => {
    const html = render(false);
    expect(toggle(html)).toContain('data-bg-setting="codex_progress_metrics"');
    expect(toggle(html)).toContain('aria-checked="false"');
    expect(toggle(html)).not.toContain("checked=\"\"");
    expect(html).toContain(t("settings.codexProgressMetrics"));
    expect(html).toContain(t("settings.codexProgressMetricsHint"));
    expect(html).not.toContain('data-bg-codex-progress-note="on"');
    expect(html).not.toContain(t("settings.codexProgressMetricsOn"));
  });

  test("Given the setting on When Settings renders Then the switch is checked and the on-note is shown", () => {
    const html = render(true);
    expect(toggle(html)).toContain('aria-checked="true"');
    expect(toggle(html)).toContain('checked=""');
    const note = html.match(/<p[^>]*role="note"[^>]*data-bg-codex-progress-note="on"[^>]*>([^<]*)<\/p>/)?.[1];
    expect(note).toBe(t("settings.codexProgressMetricsOn"));
  });

  test("Given the Settings dialog When saved Then the toggle sits beside the provider settings and its value is sent", () => {
    expect(source.indexOf("<CodexProgressMetricsToggle")).toBeGreaterThan(source.indexOf('t("settings.webAssetSearchHint")'));
    expect(source.indexOf("<CodexProgressMetricsToggle")).toBeLessThan(source.indexOf('id="commandcode-api-key"'));
    expect(source).toContain("codex_progress_metrics: settings.codex_progress_metrics,");
  });

  test("Given every locale When the toggle copy is resolved Then each key has copy", () => {
    for (const key of ["settings.codexProgressMetrics", "settings.codexProgressMetricsHint", "settings.codexProgressMetricsOn"] as const) {
      for (const locale of LOCALES) expect(settingsMessages[key][locale].length, `${key}/${locale}`).toBeGreaterThan(0);
    }
  });
});
