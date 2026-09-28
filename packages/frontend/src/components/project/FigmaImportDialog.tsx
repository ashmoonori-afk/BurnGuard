import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { CreateFigmaImportResponse, FigmaImportNodeSummary } from "@bg/shared/figma-import";
import { FileJson2, Link2, Upload } from "lucide-react";
import { importFigmaApi, importFigmaExport, inspectFigmaImport } from "@/api/figma-import";
import { apiErrorCopy } from "@/lib/error-copy";
import { useT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  busyDialogProps,
} from "@/components/ui/dialog";
import { FigmaExportPreviewError, parseFigmaExportPreview } from "./figma-export-preview";

type ImportSource = "api" | "export";

export default function FigmaImportDialog({
  projectId,
  open,
  onOpenChange,
  onImported,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImported: () => Promise<void>;
}) {
  const t = useT();
  const [source, setSource] = useState<ImportSource>("api");
  const [sourceUrl, setSourceUrl] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [folderFiles, setFolderFiles] = useState<readonly File[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [nodes, setNodes] = useState<readonly FigmaImportNodeSummary[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [previewError, setPreviewError] = useState(false);
  const [result, setResult] = useState<CreateFigmaImportResponse | null>(null);
  const inspectMutation = useMutation({
    mutationFn: () => inspectFigmaImport(projectId, { source_url: sourceUrl.trim() }),
    onSuccess: (inspection) => {
      setNodes(inspection.nodes);
      setSelected(inspection.selected_node_id !== null && inspection.nodes.some((node) => node.node_id === inspection.selected_node_id)
        ? [inspection.selected_node_id]
        : []);
      setFileKey(inspection.file_key);
      setPreviewError(false);
    },
  });
  const importMutation = useMutation({
    mutationFn: async () => {
      if (source === "api") {
        return importFigmaApi(projectId, { source_url: sourceUrl.trim(), node_ids: selected });
      }
      if (documentFile === null) throw new FigmaExportPreviewError();
      const form = new FormData();
      form.set("file_key", fileKey.trim());
      form.set("node_ids", JSON.stringify(selected));
      form.set("document", documentFile);
      for (const file of folderFiles) {
        if (file === documentFile || (!file.name.toLowerCase().endsWith(".png") && !file.name.toLowerCase().endsWith(".svg"))) continue;
        form.append("assets", file);
        form.append("asset_paths", file.webkitRelativePath || file.name);
      }
      return importFigmaExport(projectId, form);
    },
    onSuccess: async (next) => {
      setResult(next);
      await onImported();
    },
  });
  const busy = inspectMutation.isPending || importMutation.isPending;
  const error = importMutation.isError
    ? apiErrorCopy(importMutation.error)
    : inspectMutation.isError
      ? apiErrorCopy(inspectMutation.error)
      : previewError
        ? t("workspace.figma.invalidExport")
        : null;
  const canImport = selected.length > 0 && (source === "api" ? sourceUrl.trim().length > 0 : documentFile !== null && /^[A-Za-z0-9]{8,}$/u.test(fileKey.trim()));

  const loadFolder = async (files: readonly File[]): Promise<void> => {
    setFolderFiles(files);
    setResult(null);
    setPreviewError(false);
    const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith(".json"));
    if (jsonFiles.length !== 1) {
      setDocumentFile(null);
      setNodes([]);
      setSelected([]);
      setPreviewError(true);
      return;
    }
    const file = jsonFiles[0];
    if (file === undefined) return;
    try {
      const preview = parseFigmaExportPreview(JSON.parse(await file.text()));
      setDocumentFile(file);
      setNodes(preview.nodes);
      setSelected([]);
    } catch (cause) {
      if (!(cause instanceof SyntaxError) && !(cause instanceof FigmaExportPreviewError)) throw cause;
      setDocumentFile(null);
      setNodes([]);
      setSelected([]);
      setPreviewError(true);
    }
  };

  const resetSource = (next: ImportSource): void => {
    setSource(next);
    setNodes([]);
    setSelected([]);
    setResult(null);
    setPreviewError(false);
    inspectMutation.reset();
    importMutation.reset();
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent {...busyDialogProps(busy)}>
      <DialogHeader>
        <DialogTitle>{t("workspace.figma.title")}</DialogTitle>
        <DialogDescription>{t("workspace.figma.description")}</DialogDescription>
      </DialogHeader>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="sr-only">{t("workspace.figma.source")}</legend>
        <Button type="button" variant={source === "api" ? "default" : "outline"} onClick={() => resetSource("api")}><Link2 className="h-4 w-4" />{t("workspace.figma.urlSource")}</Button>
        <Button type="button" variant={source === "export" ? "default" : "outline"} onClick={() => resetSource("export")}><FileJson2 className="h-4 w-4" />{t("workspace.figma.exportSource")}</Button>
      </fieldset>
      {source === "api" ? (
        <div className="space-y-3">
          <label htmlFor="figma-source-url" className="block text-sm">{t("workspace.figma.url")}</label>
          <Input id="figma-source-url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} disabled={busy} placeholder="https://www.figma.com/design/..." />
          <Button type="button" variant="outline" className="w-full" disabled={busy || sourceUrl.trim().length === 0} onClick={() => inspectMutation.mutate()}>{inspectMutation.isPending ? t("workspace.figma.inspecting") : t("workspace.figma.inspect")}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <label htmlFor="figma-file-key" className="block text-sm">{t("workspace.figma.fileKey")}</label>
          <Input id="figma-file-key" value={fileKey} onChange={(event) => setFileKey(event.target.value)} disabled={busy} />
          <label htmlFor="figma-export-folder" className="block text-sm">{t("workspace.figma.exportFolder")}</label>
          <input id="figma-export-folder" type="file" className="block w-full text-sm" disabled={busy} {...{ webkitdirectory: "", directory: "", multiple: true }} onChange={(event) => void loadFolder(Array.from(event.target.files ?? []))} />
          <p className="text-xs text-muted-foreground">{t("workspace.figma.exportHelp")}</p>
        </div>
      )}
      {nodes.length > 0 && <fieldset className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">{t("workspace.figma.nodes")}</legend>
        {nodes.map((node) => <label key={node.node_id} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-muted">
          <input
            type="checkbox"
            checked={selected.includes(node.node_id)}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, node.node_id] : current.filter((id) => id !== node.node_id))}
          />
          <span className="min-w-0 flex-1 truncate text-sm" title={node.name}>{node.name}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{node.node_type}</span>
        </label>)}
      </fieldset>}
      {error !== null && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-foreground">{error}</p>}
      {result !== null && <div role="status" className="rounded-lg bg-success/10 p-3 text-sm">
        <p className="font-medium">{t("workspace.figma.imported")}</p>
        <p className="text-muted-foreground">{t("workspace.figma.importedSummary", { nodes: result.imported_node_count, assets: result.imported_asset_count, unmatched: result.token_mapping.unmatched })}</p>
      </div>}
      <Button type="button" className="w-full" disabled={busy || !canImport} onClick={() => importMutation.mutate()}>
        <Upload className="h-4 w-4" />{importMutation.isPending ? t("workspace.figma.importing") : t("workspace.figma.import")}
      </Button>
    </DialogContent>
  </Dialog>;
}
