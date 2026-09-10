import type { DesignAuditFinding } from "@bg/shared";
import { AlertCircle, CircleHelp, Loader2, RefreshCw, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { designAuditControlAvailability, groupDesignAuditResult, type DesignAuditActionContext, type DesignAuditViewState } from "@/lib/design-audit-state";
import QualityFindingCard, { type RevealResult } from "./QualityFindingCard";
import { DESIGN_AUDIT_CHECK_COPY, DESIGN_AUDIT_ERROR_COPY, DESIGN_AUDIT_STATUS_COPY, DESIGN_AUDIT_UNKNOWN_COPY } from "./design-audit-copy";

export type QualityPanelBinding = {
  readonly state: DesignAuditViewState;
  readonly pendingFindingId: string | null;
  readonly focusedFindingId: string | null;
  readonly revealResult: RevealResult;
  readonly onRetry: () => void;
  readonly onOpenFile: (finding: DesignAuditFinding) => void;
  readonly onReveal: (finding: DesignAuditFinding) => void;
  readonly onApplySafeFix: (finding: DesignAuditFinding) => void;
  readonly onAutoFix: () => void;
  readonly autoFixPending: boolean;
  readonly autoFixDisabled: boolean;
};

export default function QualityPanel({ quality }: { readonly quality: QualityPanelBinding }) {
  const running = quality.autoFixPending || ("running" in quality.state && quality.state.running);
  const report = reportFromState(quality.state);
  const current = !running && (quality.state.kind === "error_warm" ? quality.state.current : quality.state.kind === "must_fix" || quality.state.kind === "recommended" || quality.state.kind === "ready");
  const actionContext: DesignAuditActionContext = { current, running, pendingFindingId: quality.pendingFindingId };
  const controls = designAuditControlAvailability(actionContext);
  const grouped = report === null ? null : groupDesignAuditResult(report);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">품질 점검</h2>
            <p role="status" aria-live="polite" className="mt-1 text-pretty break-keep text-xs leading-relaxed text-muted-foreground">{statusCopy(quality.state)}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 px-2 max-[900px]:min-h-11" disabled={!controls.canRetry || quality.state.kind === "unavailable"} onClick={quality.onRetry}>
            {running ? <Loader2 className="motion-safe:animate-spin" /> : <RefreshCw />}다시 검사
          </Button>
        </div>
        <Button type="button" size="sm" className="mt-3 w-full max-[900px]:min-h-11" disabled={quality.autoFixDisabled || !current || !controls.canRetry || grouped === null || grouped.mustFix.length + grouped.recommended.length === 0} onClick={quality.onAutoFix}>
          {quality.autoFixPending ? <Loader2 className="motion-safe:animate-spin" /> : <WandSparkles />}{quality.autoFixPending ? "자동으로 수정하고 있어요" : "문제 자동 수정"}
        </Button>
        <p className="mt-1.5 break-keep text-[11px] leading-relaxed text-muted-foreground">현재 검사 결과를 AI에 보내 수정하고, 작업이 끝나면 다시 검사해요. 덱은 생성 완료 전에 전체 문안·글꼴·이미지 중복·아트보드 크기를 AI가 한 번 더 점검해요. 문안 기본 검사는 미완성 문구를 찾으며, 사실 검증을 대신하지 않아요.</p>
        {(quality.state.kind === "error_cold" || quality.state.kind === "error_warm") && <p role="alert" className="mt-2 text-pretty break-keep rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-foreground">{DESIGN_AUDIT_ERROR_COPY[quality.state.errorCode]}</p>}
        {(quality.state.kind === "stale" || quality.state.kind === "error_warm" && !quality.state.current) && <p className="mt-2 text-pretty break-keep rounded bg-warning/15 px-2 py-1.5 text-xs text-foreground">{"이전 결과예요. 현재 결과물에는 안전 수정을 적용할\u00A0수\u00A0없어요."}</p>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-gutter:stable]">
        {report === null ? <ColdState kind={quality.state.kind} /> : grouped && <>
          <FindingGroup title="고쳐야 할 문제" findings={grouped.mustFix} emptyCopy="고쳐야 할 문제가 없어요." actionContext={actionContext} quality={quality} />
          <FindingGroup title="권장 개선" findings={grouped.recommended} emptyCopy="권장 개선이 없어요." actionContext={actionContext} quality={quality} />
          <section className="mt-4" aria-labelledby="quality-unknown-title">
            <h3 id="quality-unknown-title" className="mb-2 text-xs font-semibold">확인하지 못한 항목</h3>
            {grouped.unknown.length === 0 ? <p className="text-xs text-muted-foreground">확인하지 못한 항목이 없어요.</p> : <div className="space-y-2">{grouped.unknown.map((item) => <article key={item.code} className="rounded-md border border-warning/50 bg-warning/10 p-3">
              <div className="flex items-start gap-2"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><div className="min-w-0"><div className="text-xs font-semibold">{DESIGN_AUDIT_CHECK_COPY[item.code]}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{DESIGN_AUDIT_STATUS_COPY[item.status]}</div></div></div>
              <p className="mt-2 break-keep text-xs leading-relaxed">{DESIGN_AUDIT_UNKNOWN_COPY[item.reason]} <strong>{"통과로 볼\u00A0수\u00A0없어요."}</strong></p>
            </article>)}</div>}
          </section>
          <details className="mt-4 rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">통과한 검사 {grouped.passedCount}개</summary>
            <p className="mt-2 break-keep text-xs text-muted-foreground">명시적으로 통과한 검사만 포함해요.</p>
          </details>
        </>}
      </div>
    </div>
  );
}

function FindingGroup({ title, findings, emptyCopy, actionContext, quality }: { readonly title: string; readonly findings: readonly DesignAuditFinding[]; readonly emptyCopy: string; readonly actionContext: DesignAuditActionContext; readonly quality: QualityPanelBinding }) {
  return <section className="mb-4"><h3 className="mb-2 text-xs font-semibold">{title} <span className="font-normal text-muted-foreground">{findings.length}</span></h3>
    {findings.length === 0 ? <p className="text-xs text-muted-foreground">{emptyCopy}</p> : <div className="space-y-2">{findings.map((finding) => <QualityFindingCard key={finding.id} finding={finding} actionContext={actionContext} revealResult={quality.focusedFindingId === finding.id ? quality.revealResult : null} onOpenFile={quality.onOpenFile} onReveal={quality.onReveal} onApplySafeFix={quality.onApplySafeFix} />)}</div>}
  </section>;
}

function ColdState({ kind }: { readonly kind: DesignAuditViewState["kind"] }) {
  if (kind === "loading") return <div className="flex items-center gap-2 text-pretty text-xs text-muted-foreground"><Loader2 className="h-4 w-4 motion-safe:animate-spin" />{"결과물을 검사하고\u00A0있어요."}</div>;
  if (kind === "unavailable") return <div className="flex items-start gap-2 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p className="break-keep">렌더링할 결과물이 생기면 품질 점검을 사용할 수 있어요.</p></div>;
  return <div className="flex items-start gap-2 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p className="break-keep">표시할 이전 검사 결과가 없어요. 다시 검사해 주세요.</p></div>;
}

function reportFromState(state: DesignAuditViewState) {
  switch (state.kind) {
    case "error_warm": case "stale": case "must_fix": case "recommended": case "ready": return state.report;
    case "loading": case "idle": case "error_cold": case "unavailable": return null;
    default: return assertNever(state);
  }
}
function statusCopy(state: DesignAuditViewState): string {
  switch (state.kind) {
    // `\u00A0` binds only the Korean auxiliary units (`-고 있다`, `-지 않다`)
    // so an ending never orphans onto its own line in the narrow panel.
    case "loading": return "결과물을 처음 검사하고\u00A0있어요.";
    case "idle": return "검사 결과가 아직 없어요. 다시 검사해 주세요.";
    case "error_cold": return "검사 결과를 불러오지 못했어요.";
    case "error_warm": return "최근 결과를 보여드려요. 새 검사는 완료되지\u00A0않았어요.";
    case "stale": return state.running ? "이전 결과를 보여드리며 현재 결과물을 검사하고\u00A0있어요." : "결과물이 바뀌어 이전 검사 결과를 보여드려요.";
    case "must_fix": return state.running ? "최근 결과를 보여드리며 다시 검사하고\u00A0있어요." : "개선을 권장하는 항목이 있어요. 내보내기는 그대로 가능해요.";
    case "recommended": return state.running ? "최근 결과를 보여드리며 다시 검사하고\u00A0있어요." : "고쳐야 할 문제는 없고 권장 개선이 있어요.";
    case "ready": return state.running ? "통과한 최근 결과를 보여드리며 다시 검사하고\u00A0있어요." : "현재 결과물이 모든 품질 검사를 통과했어요.";
    case "unavailable": return "렌더링 가능한 결과물이 아직 없어요.";
    default: return assertNever(state);
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected quality state: ${String(value)}`);
}
