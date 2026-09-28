import { Archive } from "lucide-react";
import { useState } from "react";
import { readProjectBundleDownload } from "@/api/project-bundle";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";
import { apiErrorCopy } from "@/lib/error-copy";
import { useUIStore } from "@/state/uiStore";

export function ProjectBundleControl({
  pending,
  onExport,
}: {
  readonly pending: boolean;
  readonly onExport: () => void;
}) {
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-h-10 gap-2 px-3 max-[900px]:min-h-11"
      disabled={pending}
      onClick={onExport}
    >
      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
      {t(pending ? "export.projectBundlePending" : "export.projectBundle")}
    </Button>
  );
}

export default function ProjectBundleButton({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const pushToast = useUIStore((state) => state.pushToast);
  const [pending, setPending] = useState(false);

  const onExport = async () => {
    setPending(true);
    try {
      const download = await readProjectBundleDownload(projectId);
      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = download.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast({ tone: "success", title: t("export.projectBundleReady") });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      pushToast({
        tone: "error",
        title: t("export.projectBundleFailed"),
        body: apiErrorCopy(error),
      });
    } finally {
      setPending(false);
    }
  };

  return <ProjectBundleControl pending={pending} onExport={onExport} />;
}
