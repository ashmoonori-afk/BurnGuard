import { useT } from "@/i18n/t";
import type { DesignAuditFinding } from "@bg/shared";
import { AlertTriangle, Eye, FileCode2, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { designAuditActionAvailability, type DesignAuditActionContext } from "@/lib/design-audit-state";
import { DESIGN_AUDIT_ACTION_COPY, DESIGN_AUDIT_CHECK_COPY } from "./design-audit-copy";

export type RevealResult = "found" | "not_found" | null;

export default function QualityFindingCard({ finding, actionContext, revealResult, onOpenFile, onReveal, onApplySafeFix }: {
  readonly finding: DesignAuditFinding;
  readonly actionContext: DesignAuditActionContext;
  readonly revealResult: RevealResult;
  readonly onOpenFile: (finding: DesignAuditFinding) => void;
  readonly onReveal: (finding: DesignAuditFinding) => void;
  readonly onApplySafeFix: (finding: DesignAuditFinding) => void;
}) {
  const t = useT();
  const actions = designAuditActionAvailability(finding, actionContext);
  const mustFix = finding.severity === "must_fix";
  return (
    <article className="min-w-0 rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-2">
        <span className={mustFix ? "mt-0.5 text-destructive" : "mt-0.5 text-warning"} aria-hidden="true">
          {mustFix ? <AlertTriangle className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">{DESIGN_AUDIT_CHECK_COPY[finding.check_code]}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{mustFix ? t("modes.quality.mustFix") : t("modes.quality.recommended")}</div>
        </div>
      </div>
      <p className="mt-2 break-keep text-xs leading-relaxed">{DESIGN_AUDIT_ACTION_COPY[finding.targeted_action]}</p>
      <div className="mt-2 min-w-0 rounded bg-muted px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground" title={finding.evidence}>
        <span className="block font-sans font-medium text-foreground">{t("modes.quality.evidence")}</span>
        <span className="block max-h-12 overflow-hidden break-words">{finding.evidence}</span>
        {(finding.measured !== undefined || finding.threshold !== undefined) && <span className="mt-1 block">{t("modes.quality.measurement", { measured: finding.measured ?? "-", threshold: finding.threshold ?? "-" })}</span>}
      </div>
      <div className="mt-2 min-w-0 truncate font-mono text-[10px] text-muted-foreground" title={`${finding.source.rel_path}${finding.source.node_bg_id ? ` · ${finding.source.node_bg_id}` : ""}`}>
        {finding.source.rel_path}{finding.source.node_bg_id ? ` · ${finding.source.node_bg_id}` : t("modes.quality.noLocation")}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {actions.canOpenFile && <Button type="button" variant="outline" size="sm" className="h-8 px-2 max-[900px]:min-h-11" onClick={() => onOpenFile(finding)}><FileCode2 />{t("modes.quality.openFile")}</Button>}
        {actions.canReveal && <Button type="button" variant="outline" size="sm" className="h-8 px-2 max-[900px]:min-h-11" onClick={() => onReveal(finding)}><Eye />{t("modes.quality.reveal")}</Button>}
        {finding.safe_fix && <Button type="button" variant="outline" size="sm" className="h-8 px-2 max-[900px]:min-h-11" disabled={!actions.canApplySafeFix} title={!actionContext.current ? t("modes.quality.staleFix") : actionContext.running ? t("modes.quality.waitForCheck") : actions.applying ? t("modes.quality.applyingFix") : actionContext.pendingFindingId !== null ? t("modes.quality.otherFix") : undefined} onClick={() => onApplySafeFix(finding)}><ShieldCheck />{actions.applying ? t("modes.quality.applying") : t("modes.quality.applyFix")}</Button>}
      </div>
      {revealResult !== null && <p className="mt-2 break-keep text-[11px] text-muted-foreground">{revealResult === "found" ? t("modes.quality.revealed") : t("modes.quality.notFound")}</p>}
    </article>
  );
}
