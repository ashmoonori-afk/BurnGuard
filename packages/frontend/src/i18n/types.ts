import type { Locale } from "./locale";

export type Message = string | { readonly one: string; readonly other: string };
export type MessageParams = Readonly<Record<string, string | number>>;
export type MessageDefinition = Readonly<Record<Locale, Message>>;

export function defineMessages<const T extends Readonly<Record<string, MessageDefinition>>>(messages: T): T {
  return messages;
}
