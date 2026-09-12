import { useState } from "react";
import { useT } from "@/i18n/t";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ProjectImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [source, setSource] = useState<"zip" | "folder">("zip");
  const [files, setFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async () => {
      const body = new FormData(); body.set("name", name.trim()); body.set("source", source);
      for (const file of files) { body.append("files", file); if (source === "folder") body.append("paths", file.webkitRelativePath || file.name); }
      return apiFetch<{ id: string }>("/api/projects/import", { method: "POST", body });
    },
    onSuccess: async project => { await queryClient.invalidateQueries({ queryKey: ["projects"] }); onOpenChange(false); navigate(`/projects/${project.id}`); },
  });
  const oversized = files.reduce((sum, file) => sum + file.size, 0) > 48 * 1024 * 1024 || files.length > 10_000;
  const code = mutation.error instanceof ApiError ? mutation.error.code : "";
  return <Dialog open={open} onOpenChange={next => { if (!mutation.isPending) onOpenChange(next); }}>
    <DialogContent><DialogHeader><DialogTitle>{t("home.importProject")}</DialogTitle><DialogDescription>{t("home.projectImport.description")}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!oversized && files.length && name.trim()) mutation.mutate(); }}>
        <label className="block space-y-2 text-sm">{t("home.creation.name")}<Input value={name} maxLength={200} onChange={event => setName(event.target.value)} disabled={mutation.isPending} required /></label>
        <label className="block space-y-2 text-sm">{t("home.projectImport.format")}<select className="w-full rounded-md border border-border bg-background p-2" value={source} disabled={mutation.isPending} onChange={event => { setSource(event.target.value as "zip" | "folder"); setFiles([]); mutation.reset(); }}><option value="zip">{t("home.projectImport.zip")}</option><option value="folder">{t("home.projectImport.folder")}</option></select></label>
        <label className="block space-y-2 text-sm">{source === "zip" ? t("home.projectImport.selectZip") : t("home.projectImport.selectFolder")}<input key={source} type="file" className="block w-full" disabled={mutation.isPending} {...(source === "zip" ? { accept: ".zip" } : { webkitdirectory: "", directory: "", multiple: true })} onChange={event => { const next = Array.from(event.target.files ?? []); setFiles(next); mutation.reset(); if (!name && next[0]) setName((next[0].webkitRelativePath.split("/")[0] || next[0].name).replace(/\.zip$/i, "").slice(0, 200)); }} /></label>
        <p className="text-xs text-muted-foreground">{t("home.projectImport.limits")}</p>
        <p className="text-xs text-muted-foreground">{t("home.projectImport.docs")}</p>
        {files.length > 0 && <p role="status" className="text-xs">{t("home.projectImport.selected", { count: files.length })}</p>}
        {(oversized || mutation.isError) && <p role="alert" className="text-sm text-destructive">{oversized || code === "project_import_limit" || code === "payload_too_large" ? t("home.projectImport.limitError") : code === "project_import_entrypoint" ? t("home.projectImport.entryError") : t("home.projectImport.error")}</p>}
        <Button className="w-full" type="submit" disabled={mutation.isPending || oversized || !files.length || !name.trim()}>{mutation.isPending ? t("home.projectImport.pending") : t("home.projectImport.open")}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
