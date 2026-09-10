import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import type { VercelDeployment } from "@bg/shared";
import { apiFetch, ApiError } from "@/api/client";
import { createExport, getExport } from "@/api/export";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const errors: Record<string, string> = {
  publish_size_limit: "빠른 공유는 합계 100MB까지 지원해요. HTML ZIP으로 내려받아 직접 배포해 주세요.",
  publish_unsafe_asset: "공유할 수 없는 설정 파일이나 비공개 경로가 포함되어 있어요. 결과물을 확인해 주세요.",
  publish_auth_failed: "Vercel 토큰과 팀 ID의 권한을 확인해 주세요.",
  publish_rate_limit: "Vercel 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
  publish_build_failed: "Vercel 배포가 실패했어요. Vercel 대시보드에서 확인해 주세요.",
};

export default function VercelShare({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deployment, setDeployment] = useState<VercelDeployment | null>(null);
  const job = useQuery({ queryKey: ["share-export", jobId], queryFn: () => getExport(jobId!), enabled: open && !!jobId,
    refetchInterval: (query) => query.state.status === "error" ? false : query.state.data && ["succeeded", "failed"].includes(query.state.data.status) ? false : 1500 });
  async function prepare() {
    setBusy(true); setMessage(""); setDeployment(null);
    try { setJobId((await createExport(projectId, "html_zip", { skip_quality_check: true })).id); }
    catch { setMessage("HTML 내보내기를 준비하지 못했어요. 결과물과 내보내기 상태를 확인해 주세요."); }
    finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); setMessage("");
    try {
      const result = await apiFetch<VercelDeployment>(`/api/exports/${jobId}/vercel`, { method: "POST", body: JSON.stringify({ token: token.trim(), ...(teamId.trim() ? { team_id: teamId.trim() } : {}), ...(deployment ? { deployment_id: deployment.id } : {}) }) });
      setDeployment(result);
      if (result.ready) setToken("");
    } catch (error) { setMessage(error instanceof ApiError ? errors[error.code] ?? "게시하지 못했어요. 내보내기와 Vercel 계정을 확인해 주세요." : "연결이 끊겼어요. 중복 게시 전에 Vercel 대시보드를 확인해 주세요."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); if (!value) setToken(""); } }}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Share2 className="mr-1 size-4" />공유</Button></DialogTrigger>
    <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Vercel에 게시하기</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">현재 결과물의 HTML·CSS·이미지를 공개 웹사이트로 게시해요. 품질검사 통과 여부와 관계없이 현재 상태 그대로 게시할 수 있어요.</p>
      <p className="text-xs text-muted-foreground">Vercel Hobby는 개인·비상업 용도로 무료예요. 상업용은 계정 요금제를 확인해 주세요. 토큰은 저장하지 않아요.</p>
      <a className="text-sm underline" href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">Vercel 토큰 만들기</a>
      <label className="text-sm">Vercel 토큰<input className="mt-1 w-full rounded border bg-background p-2" disabled={busy} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></label>
      <label className="text-sm">팀 ID (선택)<input className="mt-1 w-full rounded border bg-background p-2" disabled={busy} placeholder="team_…" value={teamId} onChange={(event) => setTeamId(event.target.value)} /></label>
      <Button variant="outline" disabled={busy || (!!jobId && !job.isError && !["succeeded", "failed"].includes(job.data?.status ?? ""))} onClick={() => void prepare()}>현재 결과물 준비</Button>
      <p role="status" className="text-sm">{busy ? "요청 처리 중이에요…" : job.isError ? "내보내기 상태를 확인하지 못했어요. 다시 준비해 주세요." : job.data?.status === "succeeded" ? `리비전 ${job.data.latest_attempt?.project_revision} 준비 완료` : job.data?.status === "failed" ? "내보내기가 실패했어요. 내보내기 메뉴에서 원인을 확인해 주세요." : jobId ? "게시할 파일을 묶고 있어요…" : "준비 후 공개 게시 버튼을 눌러 주세요."}</p>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      {!deployment?.ready && <Button disabled={busy || !token.trim() || job.data?.status !== "succeeded"} onClick={() => void publish()}>{deployment ? "배포 상태 확인" : "Vercel에 공개 게시"}</Button>}
      {deployment && !deployment.ready && <p className="text-sm">배포가 접수됐어요. 잠시 후 상태를 확인해 주세요.</p>}
      {deployment?.ready && <div className="space-y-2"><a className="break-all text-sm underline" href={deployment.url} target="_blank" rel="noreferrer">{deployment.url}</a><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(deployment.url).then(() => setMessage("링크를 복사했어요."), () => setMessage("링크를 선택해 직접 복사해 주세요.")); }}>링크 복사</Button><p className="text-xs text-muted-foreground">Vercel 배포 보호 설정에 따라 방문자 로그인이 필요할 수 있어요.</p></div>}
    </DialogContent>
  </Dialog>;
}
