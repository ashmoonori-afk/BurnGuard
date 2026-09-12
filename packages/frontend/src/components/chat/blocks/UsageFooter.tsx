import type { SessionInfo } from "@bg/shared";
import { useT } from "@/i18n/t";

export default function UsageFooter({
  usage,
}: {
  usage: SessionInfo["usage"];
}) {
  const t = useT();
  const compact = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 10_000
        ? `${Math.round(n / 1_000)}k`
        : n;
  return (
    <div
      data-qa="usage-footer"
      title={t("chat.usage.title", { input: usage.input, output: usage.output, cached: usage.cached })}
      className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-background/95 px-4 py-2 text-[10px] text-muted-foreground backdrop-blur"
    >
      <span>{t("chat.usage.input", { count: compact(usage.input) })}</span>
      <span>{t("chat.usage.output", { count: compact(usage.output) })}</span>
      <span>{t("chat.usage.cached", { count: compact(usage.cached) })}</span>
    </div>
  );
}
