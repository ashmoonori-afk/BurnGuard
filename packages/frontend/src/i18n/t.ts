import { localeTag, useLocaleStore, type Locale } from "./locale";
import { messages, type MessageKey } from "./messages";
import type { Message, MessageDefinition, MessageParams } from "./types";

export type { MessageKey } from "./messages";

// Identifier params render their raw digits: "Version 1234", never "Version 1,234".
const IDENTIFIER_PARAMS: ReadonlySet<string> = new Set(["revision"]);

export function formatMessage(message: Message, locale: Locale, params: MessageParams = {}): string {
  const template = typeof message === "string"
    ? message
    : new Intl.PluralRules(localeTag(locale)).select(Number(params.count)) === "one" ? message.one : message.other;
  return template.replace(/\{(\w+)\}/g, (token: string, name: string) => {
    const value = params[name];
    if (value === undefined) return token;
    if (typeof value === "number" && IDENTIFIER_PARAMS.has(name)) return String(value);
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

/**
 * `useT` for a large catalog pack that is code-split instead of compiled into the eager registry.
 * The pack keeps the registry's typed-key and every-locale contract; it is undefined until loaded,
 * and so is an unknown key, so callers choose what to show meanwhile.
 */
export function useCatalogT<K extends string>(pack: Readonly<Record<K, MessageDefinition>> | undefined): (key: K, params?: MessageParams) => string | undefined {
  const locale = useLocaleStore((state) => state.locale);
  return (key, params) => {
    const definition = pack?.[key];
    return definition === undefined ? undefined : formatMessage(definition[locale], locale, params);
  };
}
