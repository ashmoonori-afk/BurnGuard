import { Link } from "react-router-dom";
import { FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";

/** Shown when the project id in the address does not exist; mirrors the design-system not-found state. */
export default function ProjectNotFound({ retrying, onRetry }: { readonly retrying: boolean; readonly onRetry: () => void }) {
  const t = useT();
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
      <div role="alert" className="mx-auto max-w-md space-y-4 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><FolderSearch className="h-6 w-6" aria-hidden="true" /></span>
        <h1 className="text-xl font-semibold">{t("workspace.project.notFound")}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{t("workspace.project.notFoundHelp")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={onRetry} disabled={retrying}>{t("workspace.project.retry")}</Button>
          <Button asChild variant="cta"><Link to="/?view=mine">{t("workspace.project.backToProjects")}</Link></Button>
        </div>
      </div>
    </div>
  );
}
