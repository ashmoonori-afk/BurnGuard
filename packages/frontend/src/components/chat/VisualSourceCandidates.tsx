import { useMemo } from "react";
import { FileImage } from "lucide-react";
import type { FileInfo } from "@bg/shared";
import { listExistingVisualSources } from "./visual-source-selection";
import { useT } from "@/i18n/t";

export function VisualSourceCandidates({ files }: { readonly files: readonly FileInfo[] }) {
  const t = useT();
  const sources = useMemo(() => listExistingVisualSources(files), [files]);
  return (
    <details className="mt-3 text-xs leading-relaxed text-muted-foreground">
      <summary className="cursor-pointer rounded py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {sources.length > 0 ? t("chat.sources.summaryWithCount", { count: sources.length }) : t("chat.sources.summary")}
      </summary>
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
      <p>{t("chat.sources.limits")}</p>
      {sources.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-foreground">{t("chat.sources.projectFiles")}</p>
          <ul className="max-h-28 space-y-1 overflow-y-auto overscroll-contain pr-1" aria-label={t("chat.sources.projectFilesAria")}>
            {sources.map((source) => (
              <li key={source.rel_path} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <FileImage className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={source.rel_path}>{source.rel_path}</span>
                <span className="shrink-0 text-[10px]">{t("chat.sources.editable")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">{t("chat.sources.existingHelp")}</p>
        </div>
      )}
      <p>{t("chat.sources.unsupportedHelp")}</p>
    </div>
    </details>
  );
}
