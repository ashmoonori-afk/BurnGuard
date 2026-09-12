import { useT, type MessageKey } from "@/i18n/t";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UX_PATTERNS, type UxReviewReport } from "@bg/shared";
import { getUxReview } from "@/api/ux-review";
import { Button } from "@/components/ui/button";
import { UX_PATTERN_COPY } from "./ux-pattern-copy";

export type UxReviewBinding = {
  projectId: string;
  relPath: string | null;
  digest: string | null;
  revision: number;
  disabled: boolean;
  onRequestAI: (text: string, signal: AbortSignal) => Promise<void>;
};

export function uxReviewIsCurrent(report: UxReviewReport, target: Pick<UxReviewBinding, "projectId" | "relPath" | "digest" | "revision">): boolean {
  return report.project_id === target.projectId && report.source_path === target.relPath && report.artifact_digest === target.digest && report.artifact_revision === target.revision;
}

export function uxReviewRequest(report: UxReviewReport, title: string, guidance: string, nodeId: string | null = null): string {
  return `UX 개선을 요청해요. 파일 ${JSON.stringify(report.source_path)}, 결과물 버전 ${report.artifact_revision}, digest ${report.artifact_digest}${nodeId ? `, 요소 data-bg-node-id=${JSON.stringify(nodeId)}` : ""}.\n${title}\n${guidance}\n정적 HTML 진단은 실제 사용성 검증 결과가 아니에요. 현재 파일과 근거를 먼저 확인하고 필요한 수정만 적용해 주세요. 요소 ID가 원본에 없거나 bg-auto 임시 앵커이면 관찰 근거로 대상을 확인하고, 대상을 확정할 수 없으면 임의로 수정하지 마세요. 기존 동작과 접근성을 유지하고 변경 내용과 미확인 항목을 설명해 주세요.`;
}

export default function UxReviewPanel({ binding }: { binding: UxReviewBinding }) {
  const t = useT();
  const { projectId, relPath, digest, revision, disabled } = binding;
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | "">("");
  const [error, setError] = useState<MessageKey | "">("");
  const requestRef = useRef<AbortController | null>(null);
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const supported = !!relPath && /\.html?$/i.test(relPath);
  const query = useQuery({
    queryKey: ["ux-review", projectId, relPath, digest, revision],
    queryFn: ({ signal }) => getUxReview(projectId, relPath!, signal),
    enabled: supported && !disabled,
    retry: false,
  });
  const report = query.data;
  const current = !!report && uxReviewIsCurrent(report, binding);
  const busy = disabled || pending || query.isFetching || !current;
  const request = async (title: string, guidance: string, nodeId: string | null = null) => {
    if (busy || !report || !relPath || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true); setError(""); setMessage("");
    try {
      const latest = await getUxReview(projectId, relPath, controller.signal);
      if (controller.signal.aborted) return;
      if (!uxReviewIsCurrent(latest, bindingRef.current) || latest.artifact_digest !== report.artifact_digest || latest.artifact_revision !== report.artifact_revision) {
        setError("modes.ux.changed");
        void query.refetch();
        return;
      }
      if (bindingRef.current.disabled) throw new Error("session_not_ready");
      await bindingRef.current.onRequestAI(uxReviewRequest(latest, title, guidance, nodeId), controller.signal);
      if (!controller.signal.aborted) setMessage("modes.ux.sent");
    } catch {
      if (!controller.signal.aborted) setError("modes.ux.requestFailed");
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };
  return <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs [scrollbar-gutter:stable]">
    <h2 className="text-sm font-semibold">{t("modes.ux.title")}</h2>
    <p className="mt-2 break-keep text-muted-foreground">{t("modes.ux.description")}</p>
    {!supported ? <p role="status" className="mt-3">{t("modes.ux.openHtml")}</p> : <>
      <Button className="my-3 min-h-11" size="sm" variant="outline" disabled={disabled || pending || query.isFetching} onClick={() => { void query.refetch(); }}>{t("modes.ux.retry")}</Button>
      {query.isFetching && <p role="status">{t("modes.ux.reviewing")}</p>}
      {query.isError && <p role="alert">{t("modes.ux.loadFailed")}</p>}
      {report && !current && <p role="status">{t("modes.ux.stale")}</p>}
      {report && <>
        <p className="mb-3 break-all text-muted-foreground">{t("modes.ux.source", { path: report.source_path, revision: report.artifact_revision })}</p>
        {report.findings.length === 0 && <p>{t("modes.ux.noFindings")}</p>}
        <div className="space-y-3">{report.findings.map((finding) => <article key={finding.id} className="rounded-md border border-border p-3">
          <h3 className="font-semibold">{finding.title}</h3>
          <p className="mt-1 text-muted-foreground">{finding.priority === "high" ? t("modes.ux.highPriority") : t("modes.ux.recommended")}{finding.node_bg_id ? t("modes.ux.node", { id: finding.node_bg_id }) : t("modes.ux.page")}</p>
          <p className="mt-2 break-words">{t("modes.ux.evidence", { evidence: finding.evidence })}</p>
          <p className="mt-2 break-keep">{t("modes.ux.proposal", { proposal: finding.proposal })}</p>
          <Button className="mt-2 min-h-11" size="sm" variant="outline" disabled={busy} onClick={() => { void request(finding.title, `관찰 근거: ${finding.evidence}\n개선 제안: ${finding.proposal}`, finding.node_bg_id); }}>{t("modes.ux.requestProposal")}</Button>
        </article>)}</div>
        <details className="my-3"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("modes.ux.limitations")}</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
      </>}
    </>}
    <section className="mt-4 border-t border-border pt-3" aria-labelledby="ux-pattern-title">
      <h3 id="ux-pattern-title" className="font-semibold">{t("modes.ux.library")}</h3>
      <p className="mt-1 text-muted-foreground">{t("modes.ux.libraryHint")}</p>
      <label className="my-2 block">{t("modes.ux.search")}<input type="search" value={filter} maxLength={100} onChange={(event) => setFilter(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={t("modes.ux.searchPlaceholder")} /></label>
      <div className="space-y-2">{UX_PATTERNS.filter((pattern) => `${t(UX_PATTERN_COPY[pattern.id].title)} ${t(UX_PATTERN_COPY[pattern.id].description)}`.toLowerCase().includes(filter.trim().toLowerCase())).map((pattern) => <article key={pattern.id} className="rounded-md border border-border p-3">
        <h4 className="font-semibold">{t(UX_PATTERN_COPY[pattern.id].title)}</h4><p className="mt-1 break-keep text-muted-foreground">{t(UX_PATTERN_COPY[pattern.id].description)}</p>
        <details className="mt-2"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("modes.ux.showGuidance")}</summary><p className="mt-1 break-keep">{t(UX_PATTERN_COPY[pattern.id].guidance)}</p></details>
        <Button className="mt-2 min-h-11" size="sm" variant="outline" disabled={busy} onClick={() => { void request(pattern.title, pattern.guidance); }}>{t("modes.ux.requestPattern")}</Button>
      </article>)}</div>
    </section>
    {pending && <p role="status" className="mt-3">{t("modes.ux.pending")}</p>}
    {message && <p role="status" className="mt-3">{t(message)}</p>}
    {error && <p role="alert" className="mt-3 text-destructive">{t(error)}</p>}
  </div>;
}
