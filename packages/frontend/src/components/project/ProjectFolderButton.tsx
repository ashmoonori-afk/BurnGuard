import { FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import { showProjectFolder } from "@/api/project";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";
import { apiErrorCopy } from "@/lib/error-copy";
import { useUIStore } from "@/state/uiStore";

export default function ProjectFolderButton({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const pushToast = useUIStore((state) => state.pushToast);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const reveal = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await showProjectFolder(projectId);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      pushToast({ tone: "error", title: t("workspace.project.folderFailed"), body: apiErrorCopy(error) });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return <Button variant="outline" size="sm" className="min-h-10 gap-2 px-3 max-[900px]:min-h-11" disabled={pending} onClick={reveal}>
    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
    {t(pending ? "workspace.project.folderPending" : "workspace.project.showFolder")}
  </Button>;
}
