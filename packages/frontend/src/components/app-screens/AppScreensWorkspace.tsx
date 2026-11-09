import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveAppScreensManifest, storedAppScreenFrame, type FileInfo, type ProjectDetail } from "@bg/shared";
import { ApiError } from "@/api/client";
import { readProjectFileText } from "@/api/files";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";
import Board from "./Board";

type Props = {
  readonly project: ProjectDetail;
  readonly files: readonly FileInfo[];
  readonly activeFile: string | null;
  readonly revision: string;
  readonly onSelect: (file: string) => void;
  readonly children: ReactNode;
};

export default function AppScreensWorkspace(props: Props) {
  if (props.project.type !== "app_screens") return <>{props.children}</>;
  return <AppScreensSurface {...props} />;
}

function AppScreensSurface({ project, files, activeFile, revision, onSelect, children }: Props) {
  const t = useT();
  const [board, setBoard] = useState(true);
  const paths = files.map((file) => file.rel_path);
  const manifest = useQuery({
    queryKey: ["app-screens", project.id, revision, paths, project.options_json],
    queryFn: async ({ signal }) => {
      let source: string | null = null;
      try {
        source = await readProjectFileText(project.id, "screens.json", signal);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
      return resolveAppScreensManifest(source, paths, storedAppScreenFrame(project.options_json));
    },
    retry: false,
  });
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-1 p-2" role="group" aria-label={t("appScreens.type")}>
      <Button variant="ghost" className={board ? "h-8 bg-muted" : "h-8"} aria-pressed={board} onClick={() => setBoard(true)}>{t("appScreens.board")}</Button>
      <Button variant="ghost" className={!board ? "h-8 bg-muted" : "h-8"} aria-pressed={!board} onClick={() => setBoard(false)}>{t("appScreens.canvas")}</Button>
    </div>
    {board ? manifest.data ? <Board projectId={project.id} manifest={manifest.data} activeFile={activeFile} revision={revision}
      onSelect={(file) => { onSelect(file); setBoard(false); }} /> :
      <div role={manifest.isError ? "alert" : "status"} className="p-8 text-sm text-muted-foreground">
        {t(manifest.isError ? "appScreens.loadError" : "appScreens.loading")}
        {manifest.isError && <Button variant="outline" onClick={() => void manifest.refetch()}>{t("appScreens.retry")}</Button>}
      </div> : children}
  </div>;
}
