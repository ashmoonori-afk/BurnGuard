import { useT, type MessageKey } from "@/i18n/t";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { isWebProjectType, type ExportJob, type ProjectType, type VercelDeployment } from "@bg/shared";
import { apiFetch, ApiError } from "@/api/client";
import { createExport, getExport } from "@/api/export";
import { getSettings } from "@/api/home";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { exportJobState } from "./export-job-state";

/** Publishing needs an output that can still be downloaded, not merely a job that once succeeded. */
export function shareExportReady(job: ExportJob | undefined): boolean {
  return job !== undefined && exportJobState(job).canDownload;
}

const errors: Record<string, MessageKey> = {
  publish_size_limit: "export.share.error.publish_size_limit",
  publish_unsafe_asset: "export.share.error.publish_unsafe_asset",
  publish_auth_failed: "export.share.error.publish_auth_failed",
  publish_rate_limit: "export.share.error.publish_rate_limit",
  publish_build_failed: "export.share.error.publish_build_failed",
  publish_token_required: "export.share.error.publish_token_required",
};

export default function VercelShare({ projectId, projectType }: { projectId: string; projectType: ProjectType }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [deployment, setDeployment] = useState<VercelDeployment | null>(null);
  const [badge, setBadge] = useState<boolean | null>(null);
  const [autoPublish, setAutoPublish] = useState(false);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings, enabled: open });
  const badgeAvailable = isWebProjectType(projectType);
  const badgeEnabled = badge ?? settings.data?.publish_made_with_badge ?? true;
  const tokenSaved = settings.data?.vercel_token_set === true;
  const job = useQuery({ queryKey: ["share-export", jobId], queryFn: () => getExport(jobId!), enabled: open && !!jobId,
    refetchInterval: (query) => query.state.status === "error" ? false : query.state.data && ["succeeded", "failed"].includes(query.state.data.status) ? false : 1500 });
  useEffect(() => {
    const current = job.data;
    if (!current || current.project_id !== projectId) return;
    queryClient.setQueryData<ExportJob[]>(["project", projectId, "exports"], (items) =>
      items?.some((item) => item.id === current.id)
        ? items.map((item) => item.id === current.id ? current : item)
        : [current, ...(items ?? [])]);
  }, [job.data, projectId, queryClient]);
  async function prepare(): Promise<boolean> {
    setBusy(true); setMessage(null); setDeployment(null);
    try {
      setJobId((await createExport(projectId, "html_zip", { skip_quality_check: true })).id);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "exports"] });
      return true;
    }
    catch { setMessage("export.share.prepareFailed"); return false; }
    finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); setMessage(null);
    try {
      const result = await apiFetch<VercelDeployment>(`/api/exports/${jobId}/vercel`, { method: "POST", body: JSON.stringify({ ...(token.trim() ? { token: token.trim() } : {}), ...(teamId.trim() ? { team_id: teamId.trim() } : {}), ...(deployment ? { deployment_id: deployment.id } : {}), ...(badgeAvailable ? { badge: badgeEnabled } : {}) }) });
      setDeployment(result);
      if (result.ready) setToken("");
    } catch (error) { setMessage(error instanceof ApiError ? errors[error.code] ?? "export.share.publishFailed" : "export.share.disconnected"); }
    finally { setBusy(false); }
  }
  const ready = shareExportReady(job.data);
  const exportFailed = job.data?.status === "failed" || (job.data !== undefined && !ready && !["pending", "running"].includes(job.data.status));
  const packaging = !!jobId && !job.isError && !["succeeded", "failed"].includes(job.data?.status ?? "");
  const publishLatest = useRef(publish);
  publishLatest.current = publish;
  // One click: prepare the html_zip export, then publish once the job-state query reports it downloadable.
  useEffect(() => {
    if (!autoPublish) return;
    if (ready) { setAutoPublish(false); void publishLatest.current(); }
    else if (job.isError || exportFailed) setAutoPublish(false);
  }, [autoPublish, ready, job.isError, exportFailed]);
  async function publishNow() {
    if (deployment || ready) return publish();
    if (await prepare()) setAutoPublish(true);
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); if (!value) { setToken(""); setAutoPublish(false); } } }}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Share2 className="mr-1 size-4" />{t("export.share.title")}</Button></DialogTrigger>
    <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t("export.share.publishTitle")}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">{t("export.share.description")}</p>
      <p className="text-xs text-muted-foreground">{t("export.share.planNote")}</p>
      <a className="text-sm underline" href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">{t("export.share.createToken")}</a>
      <label className="text-sm">{t("export.share.token")}<input className="mt-1 w-full rounded border bg-background p-2" disabled={busy || autoPublish} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />{tokenSaved && <span className="mt-1 block text-xs text-muted-foreground">{t("export.share.tokenSaved")}</span>}</label>
      <label className="text-sm">{t("export.share.teamId")}<input className="mt-1 w-full rounded border bg-background p-2" disabled={busy || autoPublish} placeholder="team_…" value={teamId} onChange={(event) => setTeamId(event.target.value)} /></label>
      {badgeAvailable && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-accent" disabled={busy || autoPublish} checked={badgeEnabled} onChange={(event) => setBadge(event.target.checked)} />{t("export.share.badge")}</label>}
      <Button variant="outline" disabled={busy || autoPublish || packaging} onClick={() => void prepare()}>{t("export.share.prepare")}</Button>
      <p role="status" className="text-sm">{busy ? t("export.share.busy") : job.isError ? t("export.share.statusFailed") : ready && job.data?.latest_attempt ? t("export.share.ready", { name: String(job.data.latest_attempt.project_revision) }) : exportFailed ? t("export.share.exportFailed") : jobId ? t("export.share.packaging") : t("export.share.prepareHint")}</p>
      {message && <p role={message === "export.share.copied" ? "status" : "alert"} className={`text-sm ${message === "export.share.copied" ? "text-muted-foreground" : "text-destructive"}`}>{t(message)}</p>}
      {!deployment?.ready && <Button disabled={busy || autoPublish || packaging || !(token.trim() || tokenSaved)} onClick={() => void publishNow()}>{deployment ? t("export.share.checkDeployment") : t("export.share.publish")}</Button>}
      {deployment && !deployment.ready && <p className="text-sm">{t("export.share.accepted")}</p>}
      {deployment?.ready && <div className="space-y-2"><a className="break-all text-sm underline" href={deployment.url} target="_blank" rel="noreferrer">{deployment.url}</a><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(deployment.url).then(() => setMessage("export.share.copied"), () => setMessage("export.share.copyFailed")); }}>{t("export.share.copyLink")}</Button><p className="text-xs text-muted-foreground">{t("export.share.protectionNote")}</p></div>}
    </DialogContent>
  </Dialog>;
}
