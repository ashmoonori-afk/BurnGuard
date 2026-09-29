import { expect, test } from "bun:test";
import { LOCALES } from "../src/i18n/locale";
import { settingsMessages } from "../src/i18n/messages/settings";

const source = await Bun.file(new URL("../src/components/settings/SettingsModal.tsx", import.meta.url)).text();

test("Given the language picker When Settings renders Then the instant-apply note sits directly under the picker and describes it", () => {
  const picker = source.indexOf('aria-labelledby="language-label" aria-describedby="language-hint"');
  const note = source.indexOf('id="language-hint" data-bg-language-note="instant"');
  expect(picker).toBeGreaterThan(-1);
  expect(note).toBeGreaterThan(picker);
  expect(source.slice(picker, note)).toContain("</fieldset>");
  expect(source.slice(picker, note).match(/<fieldset/g)).toBeNull();
  expect(source.slice(note, source.indexOf("</p>", note))).toContain('t("settings.languageHint")');
});

test("Given a language pick When it is clicked Then it still applies and persists at once", () => {
  const picker = source.slice(source.indexOf('aria-labelledby="language-label"'), source.indexOf('id="language-hint"'));
  expect(picker).toContain("persistLocale(language");
});

test("Given every locale When the note is resolved Then it has copy", () => {
  for (const locale of LOCALES) expect(settingsMessages["settings.languageHint"][locale].length, locale).toBeGreaterThan(0);
});
