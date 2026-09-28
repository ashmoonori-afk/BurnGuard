import type { VisualAlternativeSummary } from "@bg/shared";
import { Trash2 } from "lucide-react";
import type { CompareViewport } from "@/lib/visual-alternative-compare";
import { useT } from "@/i18n/t";
import AlternativeFrame from "./AlternativeFrame";

export default function AlternativeCard({
  alternative,
  viewport,
  promoting,
  deleting,
  disabled,
  onPromote,
  onDelete,
}: {
  readonly alternative: VisualAlternativeSummary;
  readonly viewport: CompareViewport;
  readonly promoting: boolean;
  readonly deleting: boolean;
  readonly disabled: boolean;
  readonly onPromote: (id: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <AlternativeFrame alternative={alternative} viewport={viewport} />
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold" title={alternative.name}>
            {alternative.name}
          </h3>
          <p className="font-mono text-xs text-muted-foreground">
            {t("workspace.alternatives.revision", {
              revision: alternative.result_revision ?? "-",
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            className="min-h-10 rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
            onClick={() => void onPromote(alternative.id)}
          >
            {promoting
              ? t("workspace.alternatives.promoting")
              : t("workspace.alternatives.promote")}
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("workspace.alternatives.delete", {
              name: alternative.name,
            })}
            className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            onClick={() => void onDelete(alternative.id)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">
              {deleting
                ? t("workspace.alternatives.deleting")
                : t("workspace.alternatives.delete", {
                  name: alternative.name,
                })}
            </span>
          </button>
        </div>
      </div>
    </article>
  );
}
