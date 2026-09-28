import { afterEach, expect, test } from "bun:test";
import { detectSystemLocale, LOCALE_STORAGE_KEY, localeTag, readStoredLocale, resolveInitialLocale, synchronizePortableLocale, useLocaleStore } from "../src/i18n/locale";
import { formatMessage } from "../src/i18n/t";

afterEach(() => useLocaleStore.getState().setLocale("ko"));

test("Given a first run When the OS primary language is detected Then Korean maps to ko, Simplified Chinese to zh-CN and everything else to en", () => {
  const cases: readonly (readonly [readonly string[], string])[] = [
    [["ko-KR"], "ko"], [["ko"], "ko"], [["KO_kr"], "ko"],
    [["zh-CN"], "zh-CN"], [["zh-Hans-CN"], "zh-CN"], [["zh-SG"], "zh-CN"], [["zh"], "zh-CN"],
    [["zh-TW"], "en"], [["zh-Hant-HK"], "en"], [["zh-Hans-HK"], "zh-CN"], [["zh-Hans-TW"], "zh-CN"], [["zh-Hant-CN"], "en"],
    [["en-US"], "en"], [["ja-JP"], "en"], [["fr-FR", "ko-KR"], "en"], [[""], "en"], [[], "en"],
  ];
  for (const [languages, expected] of cases) expect(detectSystemLocale(languages)).toBe(expected);
});

test("Given a stored explicit choice When the app starts Then it wins over the OS language; absent or invalid values fall back to detection", () => {
  expect(resolveInitialLocale("ko", ["en-US"])).toBe("ko");
  expect(resolveInitialLocale("en", ["ko-KR"])).toBe("en");
  expect(resolveInitialLocale("zh-CN", ["ko-KR"])).toBe("zh-CN");
  for (const stored of [null, "", "zh-TW", "invalid"]) {
    expect(resolveInitialLocale(stored, ["ko-KR"])).toBe("ko");
    expect(resolveInitialLocale(stored, ["de-DE"])).toBe("en");
  }
});

test("Given an explicit choice When the app restarts on a differently configured OS Then the stored choice is read back and still wins", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const globals = globalThis as { window?: unknown };
  const previousWindow = globals.window;
  globals.window = { localStorage: storage };
  try {
    expect(readStoredLocale()).toBeNull();
    useLocaleStore.getState().setLocale("en");
    expect(values.get(LOCALE_STORAGE_KEY)).toBe("en");
    expect(readStoredLocale()).toBe("en");
    expect(resolveInitialLocale(values.get(LOCALE_STORAGE_KEY) ?? null, ["ko-KR"])).toBe("en");
  } finally {
    globals.window = previousWindow;
  }
});

test("Given blocked storage When the stored choice is read Then detection applies instead of failing", () => {
  const globals = globalThis as { window?: unknown };
  const previousWindow = globals.window;
  globals.window = { localStorage: { getItem: () => { throw new DOMException("blocked", "SecurityError"); } } };
  try {
    expect(readStoredLocale()).toBeNull();
  } finally {
    globals.window = previousWindow;
  }
});

test("Given no saved choice anywhere When settings sync Then the detected locale stays in effect and nothing is persisted", async () => {
  useLocaleStore.setState({ locale: "en" });
  let saves = 0;
  await synchronizePortableLocale(async () => ({ locale: null }), async (locale) => { saves += 1; return { locale }; }, () => null);
  expect(saves).toBe(0);
  expect(useLocaleStore.getState().locale).toBe("en");
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

test("existing browser locale is published once when shared locale is unset", async () => {
  useLocaleStore.setState({ locale: "ko" });
  const saved: string[] = [];
  await synchronizePortableLocale(async () => ({ locale: null }), async (locale) => { saved.push(locale); return { locale }; }, () => "en");
  expect(saved).toEqual(["en"]);
  expect(useLocaleStore.getState().locale).toBe("en");
});

test("shared locale is authoritative and does not republish the browser cache", async () => {
  useLocaleStore.getState().setLocale("en");
  let saves = 0;
  await synchronizePortableLocale(async () => ({ locale: "zh-CN" }), async (locale) => { saves += 1; return { locale }; });
  expect(saves).toBe(0);
  expect(useLocaleStore.getState().locale).toBe("zh-CN");
});
