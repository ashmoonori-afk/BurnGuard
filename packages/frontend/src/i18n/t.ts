import { localeTag, useLocaleStore, type Locale } from "./locale";
import { messages, type MessageKey } from "./messages";
import type { Message, MessageParams } from "./types";

export type { MessageKey } from "./messages";

export function formatMessage(message: Message, locale: Locale, params: MessageParams = {}): string {
  const template = typeof message === "string"
    ? message
    : new Intl.PluralRules(localeTag(locale)).select(Number(params.count)) === "one" ? message.one : message.other;
  return template.replace(/\{(\w+)\}/g, (token: string, name: string) => {
    const value = params[name];
    if (value === undefined) return token;
    return typeof value === "number" ? new Intl.NumberFormat(localeTag(locale)).format(value) : value;
  });
}

export function t(key: MessageKey, params?: MessageParams): string {
  const locale = useLocaleStore.getState().locale;
  return formatMessage(messages[key][locale], locale, params);
}

export function useT(): typeof t {
  const locale = useLocaleStore((state) => state.locale);
  return (key, params) => formatMessage(messages[key][locale], locale, params);
}
