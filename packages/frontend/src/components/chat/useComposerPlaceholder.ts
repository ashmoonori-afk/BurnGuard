import { useT } from "@/i18n/t";

export function useComposerPlaceholder(disabled: boolean): string {
  const t = useT();
  return disabled
    ? t("chat.composer.placeholderDisabled")
    : t("chat.composer.placeholder");
}
