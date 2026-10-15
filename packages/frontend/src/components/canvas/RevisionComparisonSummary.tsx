import type { RevisionComparison } from "@bg/shared";
import { useT } from "@/i18n/t";

export interface RevisionComparisonSummaryProps {
  readonly comparison: RevisionComparison;
}

export default function RevisionComparisonSummary({ comparison }: RevisionComparisonSummaryProps) {
  const t = useT();
  return <section data-qa="revision-comparison" className="space-y-2 rounded border border-border p-3 text-xs">
    <h3 className="font-semibold">{t("revision.title")}</h3>
    <p className="text-muted-foreground">{t("revision.sourceOnly")}</p>
    {comparison.findings.length > 0 && <div role="alert" className="space-y-1 text-destructive">
      <p>{t("revision.blocked")}</p>
      <ul className="max-h-32 overflow-y-auto">{comparison.findings.map((finding, index) => <li key={index} className="break-words">{finding.rel_path}{finding.artboard_id ? ` / ${finding.artboard_id}` : ""}{finding.node_id ? ` / ${finding.node_id}` : ""}: {t(`revision.${finding.kind}`)}</li>)}</ul>
    </div>}
    <ul className="max-h-52 space-y-2 overflow-y-auto" data-qa="revision-changed-pages">{comparison.pages.map(page => <li key={JSON.stringify([page.rel_path, page.artboard_id])} className="break-words">
      <div className="font-medium">{page.rel_path}{page.artboard_id ? ` / ${page.artboard_id}` : ""}: {page.kinds.map(kind => t(`revision.${kind}`)).join(", ")}</div>
      {page.text_changes.slice(0, 20).map((change, index) => <dl key={index} className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-muted-foreground">
        <dt>{t("revision.before")}</dt><dd className="break-words">{change.before.slice(0, 400)}</dd>
        <dt>{t("revision.after")}</dt><dd className="break-words">{change.after.slice(0, 400)}</dd>
      </dl>)}
    </li>)}</ul>
    {comparison.pages.length === 0 && <p>{t("revision.noChanges")}</p>}
  </section>;
}
