import { expect, test } from "bun:test";
import { LOCALES } from "../src/i18n/locale";
import { messagePacks } from "../src/i18n/messages";
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
