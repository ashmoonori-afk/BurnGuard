import { t, useT } from "@/i18n/t";
import type { DesignDirectionSlot } from "@bg/shared";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DirectionCardProps = {
  readonly direction: DesignDirectionSlot;
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly onSelect: (directionId: string) => void;
};

export function DirectionCard({
  direction,
  selected,
  selectable,
  onSelect,
}: DirectionCardProps) {
  const t = useT();
  const pending = direction.status === "pending";
  const styleFactsId = `direction-style-facts-${direction.order}`;
  return (
    <article
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow",
        selected ? "border-accent ring-2 ring-accent/20" : "border-border",
      )}
      aria-busy={pending}
    >
      <div className="aspect-video w-full bg-muted">
        {direction.status === "ready" && direction.preview_url !== null ? (
          <img
            src={direction.preview_url}
            alt={t("directions.previewAlt", { name: direction.title })}
            width={640}
            height={360}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="grid h-full place-items-center px-5 text-center text-sm text-muted-foreground">
            {pending ? (
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="h-4 w-4" aria-hidden="true" />
                {t("directions.previewCreating")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {slotFailure(direction.status, direction.error)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold">{direction.title}</h2>
            <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground [word-break:keep-all]">
              {direction.summary}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {direction.order + 1}/3
          </span>
        </div>
        <ul
          id={styleFactsId}
          className="mt-3 flex flex-wrap gap-1.5"
          aria-label={t("directions.styleFacts")}
        >
          {direction.style_facts.map((fact) => (
            <li
              key={fact}
              className="max-w-full break-words rounded-full border border-border px-2 py-1 text-[11px]"
            >
              {fact}
            </li>
          ))}
        </ul>
        {direction.status === "ready" ? (
          <Button
            type="button"
            variant={selected ? "secondary" : "outline"}
            className={cn(
              "mt-4 min-h-11 w-full",
              selected && "disabled:opacity-100",
            )}
            aria-pressed={selected}
            aria-describedby={styleFactsId}
            disabled={!selectable || selected}
            onClick={() => onSelect(direction.id)}
          >
            {selected ? t("directions.selected") : t("directions.select")}
          </Button>
        ) : direction.status === "failed" || direction.status === "cancelled" ? (
          <p className="mt-4 flex min-h-11 items-center rounded-md border border-border bg-muted/50 px-3 text-xs leading-relaxed text-muted-foreground [word-break:keep-all]">
            {t("directions.retryHint")}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function slotFailure(
  status: DesignDirectionSlot["status"],
  error: string | null,
): string {
  if (error === "Direction generation was interrupted; retry unfinished directions.") {
    return t("directions.previewInterrupted");
  }
  if (error === "Direction generation was cancelled; retry this direction.") {
    return t("directions.previewCancelled");
  }
  switch (status) {
    case "failed":
    case "cancelled":
      return t("directions.previewFailed");
    case "pending":
      return t("directions.previewPending");
    case "ready":
      return t("directions.previewReady");
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
