import type { VisualAlternativeSummary } from "@bg/shared";
import { Trash2 } from "lucide-react";
import { useT } from "@/i18n/t";

export default function RetainedAlternatives({
  alternatives,
  disabled,
  promotingId,
  deletingId,
  onPromote,
  onDelete,
}: {
  readonly alternatives: readonly VisualAlternativeSummary[];
  readonly disabled: boolean;
  readonly promotingId: string | null;
  readonly deletingId: string | null;
  readonly onPromote: (id: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <section className="grid gap-2">
      <div>
        <h3 className="text-sm font-semibold">
          {t("workspace.alternatives.retainedTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("workspace.alternatives.retainedDescription")}
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {alternatives.map((alternative) => (
          <li
            key={alternative.id}
            className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={alternative.name}>
                {alternative.name}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {t("workspace.alternatives.revision", {
                  revision: alternative.result_revision ?? "-",
                })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                className="min-h-10 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground disabled:opacity-50"
                onClick={() => void onPromote(alternative.id)}
              >
                {promotingId === alternative.id
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
                  {deletingId === alternative.id
                    ? t("workspace.alternatives.deleting")
                    : t("workspace.alternatives.delete", {
                      name: alternative.name,
                    })}
                </span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
