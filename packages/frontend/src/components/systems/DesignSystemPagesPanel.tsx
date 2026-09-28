import { SHARED_PALETTE_MARKER, type DesignSystemPageCoverage, type DesignSystemPageRecord, type DesignSystemPageType } from "@bg/shared";
import { useT, type MessageKey } from "@/i18n/t";

const typeLabels: Record<DesignSystemPageType, MessageKey> = {
  home: "system.pages.type.home", pricing: "system.pages.type.pricing", blog: "system.pages.type.blog", docs: "system.pages.type.docs",
  product: "system.pages.type.product", about: "system.pages.type.about", contact: "system.pages.type.contact", other: "system.pages.type.other",
};
const patternLabels: Record<string, MessageKey> = {
  hero: "system.pages.pattern.hero", "feature-grid": "system.pages.pattern.featureGrid", "proof-strip": "system.pages.pattern.proofStrip",
  pricing: "system.pages.pattern.pricing", testimonials: "system.pages.pattern.testimonials", footer: "system.pages.pattern.footer",
};
const reasonLabels: Record<NonNullable<DesignSystemPageRecord["skip_reason"]>, MessageKey> = {
  robots: "system.pages.reason.robots", cap: "system.pages.reason.cap", fetch_failed: "system.pages.reason.fetchFailed", budget: "system.pages.reason.budget",
};

interface DesignSystemPagesPanelProps {
  readonly pages?: DesignSystemPageCoverage;
}

export function DesignSystemPagesPanel({ pages }: DesignSystemPagesPanelProps) {
  const t = useT();
  if (!pages) return null;
  const extracted = pages.pages.filter(page => page.status === "extracted");
  const skipped = pages.pages.filter(page => page.status === "skipped");
  const row = (page: DesignSystemPageRecord) => <li key={page.path} data-page-path={page.path} className="min-w-0 border-t border-border py-2">
    <p className="break-all font-mono text-xs">{page.path}</p>
    <p className="mt-1 text-sm"><span data-field="type">{t(typeLabels[page.page_type])}</span> · <span data-field="status">{page.status === "extracted" ? t("system.pages.extracted") : t(reasonLabels[page.skip_reason ?? "cap"])}</span></p>
    {page.patterns.length ? <p data-field="patterns" className="mt-1 break-words text-xs text-muted-foreground">{t("system.pages.patterns")}: {page.patterns.map(pattern => patternLabels[pattern] ? t(patternLabels[pattern]) : pattern).join(", ")}</p> : null}
  </li>;
  return <section className="my-5 min-w-0 rounded-2xl border border-border bg-card p-5 text-left" aria-label={t("system.pages.title")}>
    <h2 className="text-lg font-semibold">{t("system.pages.title")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("system.pages.summary", { extracted: extracted.length, discovered: pages.discovered, limit: pages.page_limit })}</p>
    <ul className="mt-4 min-w-0">{extracted.map(row)}</ul>
    {skipped.length ? <details className="mt-3 min-w-0">
      <summary className="cursor-pointer text-sm font-medium">{t("system.pages.skipped", { count: skipped.length })}</summary>
      <ul className="mt-2 min-w-0">{skipped.map(row)}</ul>
    </details> : null}
    {pages.differences.length ? <div className="mt-4 min-w-0">
      <h3 className="text-sm font-semibold">{t("system.pages.differences")}</h3>
      <ul className="mt-2 space-y-1 text-sm">{pages.differences.map(difference => <li key={difference.key} data-difference={difference.key} className="break-words"><span className="font-mono text-xs">{difference.key}</span>: <span className="text-muted-foreground">{difference.values.map(value => `${value.path} ${value.value === SHARED_PALETTE_MARKER ? t("system.pages.sharedPalette") : value.value}`).join(" · ")}</span></li>)}</ul>
    </div> : null}
  </section>;
}
