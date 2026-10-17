import type { SessionInfo } from "@bg/shared";
import { useT } from "@/i18n/t";

/** Token counters are diagnostics, so they sit behind a collapsed "Details" disclosure. */
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
    <details
      data-qa="usage-footer"
      title={t("chat.usage.title", { input: usage.input, output: usage.output, cached: usage.cached })}
      className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-1 text-xs text-muted-foreground backdrop-blur"
    >
      <summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("chat.details")}</summary>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
        <span>{t("chat.usage.input", { count: compact(usage.input) })}</span>
        <span>{t("chat.usage.output", { count: compact(usage.output) })}</span>
        <span>{t("chat.usage.cached", { count: compact(usage.cached) })}</span>
      </div>
    </details>
  );
}
