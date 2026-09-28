import type { DesignSystemPageCoverage, DesignSystemPageRecord, DesignSystemPageType } from "@bg/shared";
import { useT, type MessageKey } from "@/i18n/t";

const typeLabels: Record<DesignSystemPageType, MessageKey> = {
  home: "system.pages.type.home", pricing: "system.pages.type.pricing", blog: "system.pages.type.blog", docs: "system.pages.type.docs",
  product: "system.pages.type.product", about: "system.pages.type.about", contact: "system.pages.type.contact", other: "system.pages.type.other",
};
const reasonLabels: Record<NonNullable<DesignSystemPageRecord["skip_reason"]>, MessageKey> = {
  robots: "system.pages.reason.robots", cap: "system.pages.reason.cap", fetch_failed: "system.pages.reason.fetchFailed",
};

interface DesignSystemPagesPanelProps {
  readonly pages?: DesignSystemPageCoverage;
}

export function DesignSystemPagesPanel({ pages }: DesignSystemPagesPanelProps) {
  const t = useT();
  if (!pages) return null;
  const extracted = pages.pages.filter(page => page.status === "extracted");
  return <section className="my-5 min-w-0 rounded-2xl border border-border bg-card p-5 text-left" aria-label={t("system.pages.title")}>
    <h2 className="text-lg font-semibold">{t("system.pages.title")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("system.pages.summary", { extracted: extracted.length, discovered: pages.discovered, limit: pages.page_limit })}</p>
    <div className="mt-4 min-w-0 overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-xs text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">{t("system.pages.path")}</th><th className="py-2 pr-3 font-medium">{t("system.pages.type")}</th><th className="py-2 pr-3 font-medium">{t("system.pages.status")}</th><th className="py-2 font-medium">{t("system.pages.patterns")}</th></tr></thead>
        <tbody>{pages.pages.map(page => <tr key={page.path} className="border-t border-border align-top">
          <td className="break-all py-2 pr-3 font-mono text-xs">{page.path}</td>
          <td className="py-2 pr-3">{t(typeLabels[page.page_type])}</td>
          <td className="py-2 pr-3">{page.status === "extracted" ? t("system.pages.extracted") : t(reasonLabels[page.skip_reason ?? "cap"])}</td>
          <td className="break-words py-2 text-xs text-muted-foreground">{page.patterns.join(", ")}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pages.differences.length ? <div className="mt-4 min-w-0">
      <h3 className="text-sm font-semibold">{t("system.pages.differences")}</h3>
      <ul className="mt-2 space-y-1 text-sm">{pages.differences.map(difference => <li key={difference.key} className="break-words"><span className="font-mono text-xs">{difference.key}</span>: <span className="text-muted-foreground">{difference.values.map(value => `${value.path} ${value.value}`).join(" · ")}</span></li>)}</ul>
    </div> : null}
  </section>;
}
