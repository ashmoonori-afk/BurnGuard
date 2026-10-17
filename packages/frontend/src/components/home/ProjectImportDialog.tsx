import { useState, type RefObject } from "react";
import { t, useT } from "@/i18n/t";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "@/api/client";
import { importProjectBundle } from "@/api/project-bundle";
import { apiErrorCopy } from "@/lib/error-copy";
import { cn } from "@/lib/utils";
import { PROJECT_CONTROL_CLASS, PROJECT_LABEL_CLASS } from "@/lib/project-creation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, busyDialogProps } from "@/components/ui/dialog";
import type { ProjectBundleImportResponse, ProjectBundleImportWarning } from "@bg/shared";
import { useUIStore } from "@/state/uiStore";

// Mirrors MAX_UPLOAD and the file cap in backend project-import.ts.
const MAX_IMPORT_BYTES = 48 * 1024 * 1024;
const MAX_IMPORT_FILES = 10_000;

export type ProjectImportSource = "bundle" | "zip" | "folder";

/** Import-specific codes keep their own advice; other backend codes use the shared recovery copy, and a raw fetch failure is a connection problem, never a ZIP problem. */
export function projectImportErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return t("errors.network_error");
  if (error.code === "project_import_limit" || error.code === "project_bundle_limit") return t("home.projectImport.limitError");
  if (error.code === "project_import_entrypoint") return t("home.projectImport.entryError");
  if (error.code.startsWith("project_bundle_") || error.code === "invalid_project_bundle") return t("home.projectImport.bundleError");
  if (error.code === "invalid_project_import") return t("home.projectImport.error");
  return apiErrorCopy(error);
}

export function projectBundleWarningKey(warning: ProjectBundleImportWarning): "home.projectImport.missingBuiltin" | "home.projectImport.missingFont" {
  switch (warning.code) {
    case "missing_builtin_design_system":
      return "home.projectImport.missingBuiltin";
    case "missing_font":
      return "home.projectImport.missingFont";
    default: {
      const exhaustive: never = warning;
      return exhaustive;
    }
  }
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
  const folder = source === "folder";
  const chosen = files.length === 0 ? t(folder ? "home.projectImport.noFolder" : "home.projectImport.noFile")
    : folder ? t("home.projectImport.selected", { count: files.length }) : files[0]?.name ?? "";
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <div className="space-y-1.5"><label htmlFor="project-import-name" className={PROJECT_LABEL_CLASS}>{t("home.creation.name")}</label><Input id="project-import-name" className="max-[900px]:min-h-11" value={name} maxLength={200} onChange={event => onNameChange(event.target.value)} disabled={pending} required /></div>
    <div className="space-y-1.5"><label htmlFor="project-import-format" className={PROJECT_LABEL_CLASS}>{t("home.projectImport.format")}</label><select id="project-import-format" className={`${PROJECT_CONTROL_CLASS} min-h-10 max-[900px]:min-h-11`} value={source} disabled={pending} onChange={event => onSourceChange(event.target.value as ProjectImportSource)}><option value="bundle">{t("home.projectImport.bundle")}</option><option value="zip">{t("home.projectImport.zip")}</option><option value="folder">{t("home.projectImport.folder")}</option></select></div>
    <div className="space-y-1.5">
      <span id="project-import-file-label" className={`block ${PROJECT_LABEL_CLASS}`}>{source === "bundle" ? t("home.projectImport.selectBundle") : source === "zip" ? t("home.projectImport.selectZip") : t("home.projectImport.selectFolder")}</span>
      <div className="flex items-center gap-3">
        <input id="project-import-file" aria-labelledby="project-import-file-label" key={source} type="file" className="peer sr-only" disabled={pending} {...(source === "bundle" ? { accept: ".burnguard-project" } : source === "zip" ? { accept: ".zip" } : { webkitdirectory: "", directory: "", multiple: true })} onChange={event => onFilesChange(Array.from(event.target.files ?? []))} />
        <label htmlFor="project-import-file" className={cn("inline-flex min-h-10 shrink-0 cursor-pointer items-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:pointer-events-none peer-disabled:opacity-50 max-[900px]:min-h-11")}>{t(folder ? "home.projectImport.chooseFolder" : "home.projectImport.chooseFile")}</label>
        <span className={cn("min-w-0 flex-1 truncate text-sm", files.length === 0 ? "text-muted-foreground" : "text-foreground")} title={files.length === 1 ? chosen : undefined}>{chosen}</span>
      </div>
    </div>
    <div className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
      <p>{t(source === "bundle" ? "home.projectImport.bundleDetails" : "home.projectImport.limits")}</p>
      {source !== "bundle" && <p>{t("home.projectImport.docs")}</p>}
    </div>
    {files.length > 0 && <p role="status" className="sr-only">{t("home.projectImport.selected", { count: files.length })}</p>}
    {(oversized || error !== null) && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground">{oversized ? t("home.projectImport.limitError") : projectImportErrorCopy(error)}</p>}
    <Button className="w-full max-[900px]:min-h-11" type="submit" disabled={pending || oversized || !files.length || !name.trim()}>{pending ? t("home.projectImport.pending") : t("home.projectImport.open")}</Button>
  </form>;
}

export default function ProjectImportDialog({ open, onOpenChange, returnFocusRef }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly returnFocusRef?: RefObject<HTMLButtonElement>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [source, setSource] = useState<ProjectImportSource>("zip");
  const [files, setFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useUIStore((state) => state.pushToast);
  const mutation = useMutation({
    mutationFn: async () => {
      if (source === "bundle") {
        const file = files[0];
        if (!file) throw new ApiError("invalid_project_bundle", t("errors.fallback"), 400);
        return importProjectBundle(file, name);
      }
      const body = new FormData(); body.set("name", name.trim()); body.set("source", source);
      for (const file of files) { body.append("files", file); if (source === "folder") body.append("paths", file.webkitRelativePath || file.name); }
      return apiFetch<{ id: string; readonly warnings?: undefined }>("/api/projects/import", { method: "POST", body });
    },
    onSuccess: async (project: ProjectBundleImportResponse | { id: string; readonly warnings?: undefined }) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (project.warnings) {
        for (const warning of project.warnings) {
          pushToast({
            tone: "warn",
            title: t("home.projectImport.warningTitle"),
            body: t(projectBundleWarningKey(warning), { name: warning.reference }),
          });
        }
      }
      onOpenChange(false);
      navigate(`/projects/${project.id}`);
    },
  });
  const oversized = projectImportOversized(files);
  return <Dialog open={open} onOpenChange={next => { if (!mutation.isPending) onOpenChange(next); }}>
    <DialogContent
      {...busyDialogProps(mutation.isPending)}
      closeClassName="max-[900px]:h-11 max-[900px]:w-11"
      {...(returnFocusRef ? { onCloseAutoFocus: (event: Event) => { event.preventDefault(); returnFocusRef.current?.focus({ preventScroll: true }); } } : {})}
    ><DialogHeader><DialogTitle>{t("home.importProject")}</DialogTitle><DialogDescription>{t(source === "bundle" ? "home.projectImport.bundleDescription" : "home.projectImport.description")}</DialogDescription></DialogHeader>
      <ProjectImportForm
        name={name} source={source} files={files} pending={mutation.isPending} error={mutation.isError ? mutation.error : null} oversized={oversized}
        onNameChange={setName}
        onSourceChange={next => { setSource(next); setFiles([]); mutation.reset(); }}
        onFilesChange={next => { setFiles(next); mutation.reset(); if (!name && next[0]) setName((next[0].webkitRelativePath.split("/")[0] || next[0].name).replace(/\.(?:burnguard-project|zip)$/i, "").slice(0, 200)); }}
        onSubmit={() => { if (!oversized && files.length && name.trim()) mutation.mutate(); }}
      />
    </DialogContent>
  </Dialog>;
}
