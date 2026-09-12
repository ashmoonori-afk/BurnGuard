import { afterEach, expect, test } from "bun:test";
import { localeTag, resolveInitialLocale, useLocaleStore } from "../src/i18n/locale";
import { formatMessage } from "../src/i18n/t";

afterEach(() => useLocaleStore.getState().setLocale("ko"));

test("stored supported locale is restored and absent or invalid values preserve Korean", () => {
  expect(["ko", "en", "zh-CN", null, "", "zh-TW", "invalid"].map(resolveInitialLocale))
    .toEqual(["ko", "en", "zh-CN", "ko", "ko", "ko", "ko"]);
});

test("locale selection notifies subscribers immediately", () => {
  const changes: string[] = [];
  const unsubscribe = useLocaleStore.subscribe((state) => changes.push(state.locale));
  useLocaleStore.getState().setLocale("en");
  useLocaleStore.getState().setLocale("zh-CN");
  unsubscribe();
  expect(changes).toEqual(["en", "zh-CN"]);
  expect(localeTag(useLocaleStore.getState().locale)).toBe("zh-CN");
});

test("message interpolation formats numbers without interpreting replacement values", () => {
  expect(formatMessage("{name}:{count}", "en", { name: "$&", count: 1234 })).toBe("$&:1,234");
  expect(formatMessage("{name}", "ko", { name: "{untouched}" })).toBe("{untouched}");
});

test("plural selection follows each locale rather than assuming English rules", () => {
  const message = { one: "one:{count}", other: "other:{count}" };
  expect(formatMessage(message, "en", { count: 1 })).toBe("one:1");
  expect(formatMessage(message, "en", { count: 0 })).toBe("other:0");
  expect(formatMessage(message, "ko", { count: 1 })).toBe("other:1");
  expect(formatMessage(message, "zh-CN", { count: 1 })).toBe("other:1");
});
