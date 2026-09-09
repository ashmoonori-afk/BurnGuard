import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UX_PATTERNS, type UxReviewReport } from "@bg/shared";
import { getUxReview } from "@/api/ux-review";
import { Button } from "@/components/ui/button";

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
  const { projectId, relPath, digest, revision, disabled } = binding;
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
        setError("결과물이 바뀌었어요. 다시 진단한 뒤 요청해 주세요.");
        void query.refetch();
        return;
      }
      if (bindingRef.current.disabled) throw new Error("session_not_ready");
      await bindingRef.current.onRequestAI(uxReviewRequest(latest, title, guidance, nodeId), controller.signal);
      if (!controller.signal.aborted) setMessage("AI 수정 요청을 보냈어요. 대화에서 진행 상황을 확인해 주세요.");
    } catch {
      if (!controller.signal.aborted) setError("AI 수정 요청을 완료하지 못했어요. 대화 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };
  return <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs [scrollbar-gutter:stable]">
    <h2 className="text-sm font-semibold">UX 진단과 개선</h2>
    <p className="mt-2 break-keep text-muted-foreground">로컬 HTML의 구조를 바탕으로 개선 후보를 찾아요. 실제 화면·모바일 동작·사용자 경험을 검증한 결과는 아니에요.</p>
    {!supported ? <p role="status" className="mt-3">HTML 결과물을 열면 진단할 수 있어요.</p> : <>
      <Button className="my-3 min-h-11" size="sm" variant="outline" disabled={disabled || pending || query.isFetching} onClick={() => { void query.refetch(); }}>다시 진단</Button>
      {query.isFetching && <p role="status">현재 결과물을 진단하고 있어요.</p>}
      {query.isError && <p role="alert">진단을 불러오지 못했어요. 현재 HTML 파일을 확인하고 다시 시도해 주세요.</p>}
      {report && !current && <p role="status">이전 결과예요. 현재 결과물을 다시 진단해 주세요.</p>}
      {report && <>
        <p className="mb-3 break-all text-muted-foreground">근거 파일: {report.source_path} · 버전 {report.artifact_revision}</p>
        {report.findings.length === 0 && <p>정적 검사에서 개선 후보를 찾지 못했어요. 사용성 통과를 의미하지는 않아요.</p>}
        <div className="space-y-3">{report.findings.map((finding) => <article key={finding.id} className="rounded-md border border-border p-3">
          <h3 className="font-semibold">{finding.title}</h3>
          <p className="mt-1 text-muted-foreground">{finding.priority === "high" ? "우선 검토" : "개선 권장"}{finding.node_bg_id ? ` · 요소 ${finding.node_bg_id}` : " · 페이지"}</p>
          <p className="mt-2 break-words">근거: {finding.evidence}</p>
          <p className="mt-2 break-keep">제안: {finding.proposal}</p>
          <Button className="mt-2 min-h-11" size="sm" variant="outline" disabled={busy} onClick={() => { void request(finding.title, `관찰 근거: ${finding.evidence}\n개선 제안: ${finding.proposal}`, finding.node_bg_id); }}>이 제안으로 AI 수정 요청</Button>
        </article>)}</div>
        <details className="my-3"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">진단 범위와 한계</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
      </>}
    </>}
    <section className="mt-4 border-t border-border pt-3" aria-labelledby="ux-pattern-title">
      <h3 id="ux-pattern-title" className="font-semibold">자체 UX 패턴 라이브러리</h3>
      <p className="mt-1 text-muted-foreground">패턴을 검토하고 버튼을 누르면 현재 파일의 AI 수정 요청으로 보내요.</p>
      <label className="my-2 block">패턴 검색<input type="search" value={filter} maxLength={100} onChange={(event) => setFilter(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="타이포그래피, 모바일 등" /></label>
      <div className="space-y-2">{UX_PATTERNS.filter((pattern) => `${pattern.title} ${pattern.description}`.toLowerCase().includes(filter.trim().toLowerCase())).map((pattern) => <article key={pattern.id} className="rounded-md border border-border p-3">
        <h4 className="font-semibold">{pattern.title}</h4><p className="mt-1 break-keep text-muted-foreground">{pattern.description}</p>
        <details className="mt-2"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">수정 지침 보기</summary><p className="mt-1 break-keep">{pattern.guidance}</p></details>
        <Button className="mt-2 min-h-11" size="sm" variant="outline" disabled={busy} onClick={() => { void request(pattern.title, pattern.guidance); }}>이 패턴으로 AI 수정 요청</Button>
      </article>)}</div>
    </section>
    {pending && <p role="status" className="mt-3">현재 버전을 확인하고 AI에 요청하고 있어요.</p>}
    {message && <p role="status" className="mt-3">{message}</p>}
    {error && <p role="alert" className="mt-3 text-destructive">{error}</p>}
  </div>;
}
