import { useState } from "react";
import type { FileInfo } from "@bg/shared";
import FileTree from "@/components/files/FileTree";
import FilePreview from "@/components/files/FilePreview";

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
  const fileList = files ?? [];
  const [selection, setSelection] = useState<{ projectId: string; path: string } | null>(null);
  const active = selection?.projectId === projectId
    ? fileList.find((file) => file.rel_path === selection.path) ?? null
    : null;

  return (
    <div className="flex-1 flex min-h-0 flex-col sm:flex-row">
      <div className="h-1/2 w-full shrink-0 overflow-y-auto border-b border-border bg-background sm:h-auto sm:w-[280px] sm:border-b-0 sm:border-r">
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            프로젝트 파일
          </div>
        </div>
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
        {fileList.length === 0 && <p className="p-3 text-xs text-muted-foreground">아직 생성된 파일이 없어요.</p>}
      </div>
      <FilePreview key={`${projectId}:${active?.rel_path}:${active?.hash}:${active?.updated_at}`} projectId={projectId} file={active} />
    </div>
  );
}
