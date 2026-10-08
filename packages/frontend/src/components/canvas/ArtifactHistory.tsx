import { useT, type MessageKey } from "@/i18n/t";
import { useState } from "react";
import { localeTag, useLocaleStore } from "@/i18n/locale";
import type { ArtifactExternalCapture, ArtifactHistoryV1 } from "@bg/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const labels: Record<string, MessageKey> = { initialize: "canvas.history.kind.initialize", patch: "canvas.toolbar.edit", palette: "canvas.history.kind.palette", turn: "canvas.history.kind.turn", restore: "canvas.history.kind.restore", undo: "canvas.history.kind.undo", external: "canvas.history.kind.external", reapply_external: "canvas.history.kind.reapplyExternal" };
/** External saves reverted while a generation ran; each can be re-applied as a new save. */
export function ExternalCaptures({ captures, disabled, onReapply }: { captures: readonly ArtifactExternalCapture[]; disabled: boolean; onReapply: (operationId: string) => Promise<void> }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  if (captures.length === 0) return null;
  return <ul className="space-y-2" aria-label={t("canvas.history.externalCaptures")}>{captures.map(capture => <li key={capture.operation_id} className="rounded border border-accent p-3 text-sm"><strong>{t("canvas.history.externalCapture")}</strong><span className="mt-1 block text-xs text-muted-foreground">{new Date(capture.captured_at).toLocaleString(localeTag(locale))} · {t("canvas.history.externalCaptureFiles", { count: capture.file_count })}</span><button type="button" disabled={disabled} className="mt-2 rounded bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-50" onClick={async () => { try { await onReapply(capture.operation_id); } catch { /* Parent displays the actionable mutation error. */ } }}>{t("canvas.history.reapplyExternal")}</button></li>)}</ul>;
}

export default function ArtifactHistory({ history, disabled, onRestore, onReapply }: { history: ArtifactHistoryV1 | null | undefined; disabled: boolean; onRestore: (operationId: string) => Promise<void>; onReapply: (operationId: string) => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false), [selected, setSelected] = useState("");
  const locale = useLocaleStore((state) => state.locale);
  const entry = history?.entries.find(item => item.operation_id === selected);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" disabled={disabled || !history} className="h-9 shrink-0 rounded px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">{t("canvas.history.title")}</button></DialogTrigger>
    <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t("canvas.history.restoreTitle")}</DialogTitle><DialogDescription>{t("canvas.history.description")}</DialogDescription></DialogHeader>
      <ExternalCaptures captures={history?.external_captures ?? []} disabled={disabled} onReapply={async operationId => { await onReapply(operationId); setOpen(false); setSelected(""); }} />
      <p className="text-sm">{t("canvas.history.currentRevision", { revision: history?.current_revision ?? "-" })}</p>
      <div className="max-h-[40vh] space-y-2 overflow-y-auto" aria-label={t("canvas.history.list")}>{history?.entries.map(item => <button key={item.operation_id} type="button" aria-pressed={selected === item.operation_id} disabled={!item.available || disabled} onClick={() => setSelected(item.operation_id)} className={`w-full rounded border p-3 text-left text-sm disabled:opacity-50 ${selected === item.operation_id ? "border-accent bg-accent/10" : "border-border"}`}><strong>{t("canvas.history.revision", { revision: item.revision, kind: t(labels[item.kind] ?? "canvas.history.saved") })}</strong><span className="mt-1 block text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString(localeTag(locale))} · {item.available ? t("canvas.history.available") : t("canvas.history.expired")}</span></button>)}{history?.entries.length === 0 && <p className="text-sm text-muted-foreground">{t("canvas.history.empty")}</p>}</div>
      {entry && <p className="break-all text-xs text-muted-foreground">{t("canvas.history.changedFiles", { files: entry.files.slice(0, 6).join(", ") })}{entry.files.length > 6 ? t("canvas.history.moreFiles", { count: entry.files.length - 6 }) : ""}</p>}
      <p className="text-xs text-muted-foreground">{t("canvas.history.retention")}</p>
      <button type="button" disabled={disabled || !entry?.available} className="rounded bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-50" onClick={async () => { if (!entry) return; try { await onRestore(entry.operation_id); setOpen(false); setSelected(""); } catch { /* Parent displays the actionable mutation error. */ } }}>{t("canvas.history.restore")}</button>
    </DialogContent>
  </Dialog>;
}
