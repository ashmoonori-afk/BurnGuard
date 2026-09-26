import { expect, test } from "bun:test";
import { LOCALES } from "../src/i18n/locale";
import { messagePacks, messages } from "../src/i18n/messages";
import type { Message, MessageDefinition } from "../src/i18n/types";

function placeholders(message: Message): string[] {
  const forms = typeof message === "string" ? [message] : [message.one, message.other];
  return [...new Set(forms.flatMap((form) => [...form.matchAll(/\{(\w+)\}/g)].map((match) => match[1])))].sort();
}

test("message packs have unique machine keys and matching interpolation contracts", () => {
  const keys = new Set<string>();
  for (const pack of messagePacks) {
    for (const [key, entry] of Object.entries<MessageDefinition>(pack)) {
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      expect(Object.keys(entry).sort()).toEqual([...LOCALES].sort());
      for (const locale of LOCALES) {
        expect(placeholders(entry[locale])).toEqual(placeholders(entry.ko));
      }
    }
  }
});

test("Given every registered message When the en and zh-CN values, plural forms included, are scanned Then none contains Hangul", () => {
  const forms = (message: Message) => typeof message === "string" ? [message] : [message.one, message.other];
  const hangul = messagePacks.flatMap((pack) => Object.entries<MessageDefinition>(pack))
    .filter(([, entry]) => [...forms(entry.en), ...forms(entry["zh-CN"])].some((form) => /\p{Script=Hangul}/u.test(form)))
    .map(([key]) => key);
  expect(hangul).toEqual([]);
});

test("Given the Figma token copy When rendered in every locale Then it names the Settings section and heading that actually exist", () => {
  for (const locale of LOCALES) {
    const section = messages["settings.connections"][locale];
    const heading = messages["settings.figma"][locale];
    for (const key of ["home.figmaTokenHint", "errors.figma_token_missing"] as const) {
      expect(messages[key][locale], `${key}/${locale}`).toContain(`${section} → ${heading}`);
    }
  }
});

test("Given a message whose zh-CN value is translated When the ko value is read Then it is Korean rather than the English copy", () => {
  const entry = messages["export.downloadUnavailable"];
  expect(entry.ko).toMatch(/\p{Script=Hangul}/u);
  expect(entry.ko).not.toBe(entry.en);
});

test("Given the logo chip copy When the registry is read Then the unused add-chip key is gone", () => {
  expect(Object.hasOwn(messages, "home.logo.chipAdd")).toBe(false);
});
