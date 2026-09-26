import { useState } from "react";
import { t, useT } from "@/i18n/t";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "@/api/client";
import { apiErrorCopy } from "@/lib/error-copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, busyDialogProps } from "@/components/ui/dialog";

// Mirrors MAX_UPLOAD and the file cap in backend project-import.ts.
const MAX_IMPORT_BYTES = 48 * 1024 * 1024;
const MAX_IMPORT_FILES = 10_000;

export type ProjectImportSource = "zip" | "folder";

/** Import-specific codes keep their own advice; other backend codes use the shared recovery copy, and a raw fetch failure is a connection problem, never a ZIP problem. */
export function projectImportErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return t("errors.network_error");
  if (error.code === "project_import_limit" || error.code === "payload_too_large") return t("home.projectImport.limitError");
  if (error.code === "project_import_entrypoint") return t("home.projectImport.entryError");
  if (error.code === "invalid_project_import") return t("home.projectImport.error");
  return apiErrorCopy(error);
}

export function projectImportOversized(files: readonly File[]): boolean {
  return files.reduce((sum, file) => sum + file.size, 0) > MAX_IMPORT_BYTES || files.length > MAX_IMPORT_FILES;
}

/** The dialog body, rendered inside the portal; every input arrives as a prop so the form can be rendered on its own. */
export function ProjectImportForm({ name, source, files, pending, error, oversized = projectImportOversized(files), onNameChange, onSourceChange, onFilesChange, onSubmit }: {
  readonly name: string;
  readonly source: ProjectImportSource;
  readonly files: readonly File[];
  readonly pending: boolean;
  readonly error: unknown;
  readonly oversized?: boolean;
  readonly onNameChange: (name: string) => void;
  readonly onSourceChange: (source: ProjectImportSource) => void;
  readonly onFilesChange: (files: File[]) => void;
  readonly onSubmit: () => void;
}) {
  const t = useT();
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <label className="block space-y-2 text-sm">{t("home.creation.name")}<Input value={name} maxLength={200} onChange={event => onNameChange(event.target.value)} disabled={pending} required /></label>
    <label className="block space-y-2 text-sm">{t("home.projectImport.format")}<select className="w-full rounded-md border border-border bg-background p-2" value={source} disabled={pending} onChange={event => onSourceChange(event.target.value as ProjectImportSource)}><option value="zip">{t("home.projectImport.zip")}</option><option value="folder">{t("home.projectImport.folder")}</option></select></label>
    <label className="block space-y-2 text-sm">{source === "zip" ? t("home.projectImport.selectZip") : t("home.projectImport.selectFolder")}<input key={source} type="file" className="block w-full" disabled={pending} {...(source === "zip" ? { accept: ".zip" } : { webkitdirectory: "", directory: "", multiple: true })} onChange={event => onFilesChange(Array.from(event.target.files ?? []))} /></label>
    <p className="text-xs text-muted-foreground">{t("home.projectImport.limits")}</p>
    <p className="text-xs text-muted-foreground">{t("home.projectImport.docs")}</p>
    {files.length > 0 && <p role="status" className="text-xs">{t("home.projectImport.selected", { count: files.length })}</p>}
    {(oversized || error !== null) && <p role="alert" className="text-sm text-destructive">{oversized ? t("home.projectImport.limitError") : projectImportErrorCopy(error)}</p>}
    <Button className="w-full" type="submit" disabled={pending || oversized || !files.length || !name.trim()}>{pending ? t("home.projectImport.pending") : t("home.projectImport.open")}</Button>
  </form>;
}

export default function ProjectImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [source, setSource] = useState<ProjectImportSource>("zip");
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
  const oversized = projectImportOversized(files);
  return <Dialog open={open} onOpenChange={next => { if (!mutation.isPending) onOpenChange(next); }}>
    <DialogContent {...busyDialogProps(mutation.isPending)}><DialogHeader><DialogTitle>{t("home.importProject")}</DialogTitle><DialogDescription>{t("home.projectImport.description")}</DialogDescription></DialogHeader>
      <ProjectImportForm
        name={name} source={source} files={files} pending={mutation.isPending} error={mutation.isError ? mutation.error : null} oversized={oversized}
        onNameChange={setName}
        onSourceChange={next => { setSource(next); setFiles([]); mutation.reset(); }}
        onFilesChange={next => { setFiles(next); mutation.reset(); if (!name && next[0]) setName((next[0].webkitRelativePath.split("/")[0] || next[0].name).replace(/\.zip$/i, "").slice(0, 200)); }}
        onSubmit={() => { if (!oversized && files.length && name.trim()) mutation.mutate(); }}
      />
    </DialogContent>
  </Dialog>;
}
