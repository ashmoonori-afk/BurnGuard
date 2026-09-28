import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FIGMA_IMPORT_LIMITS, type CreateFigmaImportResponse, type FigmaImportNodeSummary } from "@bg/shared/figma-import";
import { Upload } from "lucide-react";
import { importFigmaExport } from "@/api/figma-import";
import { apiErrorCopy } from "@/lib/error-copy";
import { useT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  busyDialogProps,
} from "@/components/ui/dialog";
import {
  FigmaExportPreviewError,
  readFigmaExportPreview,
  updateFigmaSelection,
  validateFigmaExportAssets,
} from "./figma-export-preview";

export default function FigmaImportDialog({
  projectId,
  artifactRevision,
  artifactDigest,
  open,
  onOpenChange,
  onImported,
}: {
  readonly projectId: string;
  readonly artifactRevision: number;
  readonly artifactDigest: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImported: () => Promise<void>;
}) {
  const t = useT();
  const [folderFiles, setFolderFiles] = useState<readonly File[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [nodes, setNodes] = useState<readonly FigmaImportNodeSummary[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [selectionLimitReached, setSelectionLimitReached] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [result, setResult] = useState<CreateFigmaImportResponse | null>(null);
  const importMutation = useMutation({
    mutationFn: async () => {
      if (documentFile === null) throw new FigmaExportPreviewError();
      const form = new FormData();
      form.set("expected_revision", String(artifactRevision));
      form.set("expected_artifact_digest", artifactDigest);
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
  const busy = importMutation.isPending;
  const error = importMutation.isError
    ? apiErrorCopy(importMutation.error)
    : previewError
        ? t("workspace.figma.invalidExport")
        : selectionLimitReached
            ? t("workspace.figma.selectionLimit", {
              limit: FIGMA_IMPORT_LIMITS.selection,
            })
            : null;
  const canImport = selected.length > 0 && documentFile !== null;

  const loadFolder = async (files: readonly File[]): Promise<void> => {
    setFolderFiles(files);
    setResult(null);
    setPreviewError(false);
    setSelectionLimitReached(false);
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
      validateFigmaExportAssets(files.filter((candidate) =>
        candidate !== file &&
        (candidate.name.toLowerCase().endsWith(".png") || candidate.name.toLowerCase().endsWith(".svg")),
      ));
      const preview = await readFigmaExportPreview(file);
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

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent {...busyDialogProps(busy)}>
      <DialogHeader>
        <DialogTitle>{t("workspace.figma.title")}</DialogTitle>
        <DialogDescription>{t("workspace.figma.description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <label htmlFor="figma-export-folder" className="block text-sm">{t("workspace.figma.exportFolder")}</label>
        <input
          id="figma-export-folder"
          type="file"
          className="block w-full text-sm"
          disabled={busy}
          {...{ webkitdirectory: "", directory: "", multiple: true }}
          onChange={(event) => void loadFolder(Array.from(event.target.files ?? []))}
        />
        <p className="text-xs text-muted-foreground">{t("workspace.figma.exportHelp", {
          maxFileMb: Math.floor(FIGMA_IMPORT_LIMITS.documentBytes / 1_000_000),
          maxAssets: FIGMA_IMPORT_LIMITS.assets,
        })}</p>
      </div>
      {nodes.length > 0 && <fieldset className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">{t("workspace.figma.nodes")}</legend>
        {nodes.map((node) => <label key={node.node_id} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-muted">
          <input
            type="checkbox"
            checked={selected.includes(node.node_id)}
            onChange={(event) => {
              const update = updateFigmaSelection(
                selected,
                node.node_id,
                event.target.checked,
              );
              setSelected(update.selected);
              setSelectionLimitReached(update.limitReached);
            }}
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
