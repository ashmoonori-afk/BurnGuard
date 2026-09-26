import { useT, type MessageKey } from "@/i18n/t";

/** Why the composer cannot send right now; `null` means it can. */
export type ComposerDisabledReason = "busy" | "directions" | "disconnected" | null;

export function composerPlaceholderKey(reason: ComposerDisabledReason): MessageKey {
  switch (reason) {
    case "busy":
      return "chat.composer.placeholderDisabled";
    case "directions":
      return "chat.composer.placeholderDirections";
    case "disconnected":
      return "chat.composer.placeholderDisconnected";
    case null:
      return "chat.composer.placeholder";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

export function useComposerPlaceholder(reason: ComposerDisabledReason): string {
  const t = useT();
  return t(composerPlaceholderKey(reason));
}
