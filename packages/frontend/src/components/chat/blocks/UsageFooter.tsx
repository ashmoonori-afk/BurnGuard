import type { SessionInfo } from "@bg/shared";

export default function UsageFooter({
  usage,
}: {
  usage: SessionInfo["usage"];
}) {
  const exact = (n: number) => n.toLocaleString();
  const compact = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 10_000
        ? `${Math.round(n / 1_000)}k`
        : exact(n);
  return (
    <div
      data-qa="usage-footer"
      title={`입력 ${exact(usage.input)} · 출력 ${exact(usage.output)} · 캐시 ${exact(usage.cached)} 토큰`}
      className="sticky bottom-0 -mx-4 -mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-background/95 px-4 py-2 text-[10px] text-muted-foreground backdrop-blur"
    >
      <span>입력 {compact(usage.input)}</span>
      <span>출력 {compact(usage.output)}</span>
      <span>캐시 {compact(usage.cached)}</span>
    </div>
  );
}
