import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { FileInfo } from "@bg/shared";
import FileTree from "@/components/files/FileTree";
import FilePreview from "@/components/files/FilePreview";
import { useT } from "@/i18n/t";

/**
 * Used both as a route (rarely) and as embedded content within ProjectView's
 * "Design Files" artifact tab. Preview selection resolves against the latest
 * file list so a changed hash reloads its contents and a removed file closes.
 */
export default function DesignFilesView({
  projectId,
  files,
  onOpenInCanvas,
}: {
  projectId: string;
  files?: FileInfo[];
  onOpenInCanvas?: (relPath: string) => void;
}) {
  const t = useT();
  const fileList = files ?? [];
  const [selection, setSelection] = useState<{ projectId: string; path: string } | null>(null);
  const active = selection?.projectId === projectId
    ? fileList.find((file) => file.rel_path === selection.path) ?? null
    : null;

  if (fileList.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl border border-border bg-muted/50">
            <FolderOpen aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold">{t("files.empty")}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("files.emptyHelp")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden sm:flex-row">
      <aside className="flex h-48 max-h-[40%] w-full shrink-0 flex-col border-b border-border bg-muted/20 sm:h-auto sm:max-h-none sm:w-[264px] sm:border-b-0 sm:border-r">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderOpen aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <h2>{t("files.projectFiles")}</h2>
          </div>
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{t("files.count", { count: fileList.filter((file) => file.category !== "folder").length })}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTree
          files={fileList}
          activePath={active?.rel_path ?? null}
          onOpen={(f) => {
            setSelection({ projectId, path: f.rel_path });
            if (onOpenInCanvas && f.category === "html") {
              onOpenInCanvas(f.rel_path);
            }
          }}
        />
        </div>
      </aside>
      <FilePreview key={`${projectId}:${active?.rel_path}:${active?.hash}:${active?.updated_at}`} projectId={projectId} file={active} />
    </div>
  );
}
