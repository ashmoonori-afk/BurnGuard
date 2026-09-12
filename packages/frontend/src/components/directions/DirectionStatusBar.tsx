import { t, useT } from "@/i18n/t";
import type { DesignDirectionState } from "@bg/shared";
import { Compass, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type DirectionStatusBarProps = {
  readonly state: DesignDirectionState | null;
  readonly cancelPending: boolean;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
};

export function DirectionStatusBar({
  state,
  cancelPending,
  onOpen,
  onCancel,
}: DirectionStatusBarProps) {
  const t = useT();
  const selectedTitle =
    state?.directions.find((direction) => direction.id === state.selected_id)?.title ?? null;
  const loading = state?.status === "loading";
  const currentStatus = statusLabel(state);
  const fullStatus =
    selectedTitle === null ? currentStatus : `${currentStatus}${t("directions.selectedSuffix", { name: selectedTitle })}`;

  return (
    <div className="shrink-0 border-t border-border bg-muted/60 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 max-[480px]:flex-wrap">
        <Compass className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <p
          className="min-w-0 flex-1 truncate text-xs text-foreground"
          role="status"
          aria-live="polite"
          title={fullStatus}
        >
          <span className="font-medium">{currentStatus}</span>
          {selectedTitle !== null ? (
            <span className="text-muted-foreground">{t("directions.selectedSuffix", { name: selectedTitle })}</span>
          ) : null}
        </p>
        {loading ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0"
            disabled={cancelPending}
            onClick={onCancel}
          >
            <StopCircle aria-hidden="true" />
            {cancelPending ? t("directions.cancelPending") : t("directions.cancel")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 shrink-0 text-accent"
          onClick={onOpen}
        >
          {t("directions.open")}
        </Button>
      </div>
    </div>
  );
}

function statusLabel(state: DesignDirectionState | null): string {
  if (state === null) return t("directions.status.empty");
  switch (state.status) {
    case "loading":
      return t("directions.status.loading");
    case "ready":
      return t("directions.status.ready");
    case "partial":
      return t("directions.status.partial");
    case "failed":
      return t("directions.status.failed");
    case "cancelled":
      return t("directions.status.cancelled");
    default: {
      const unreachable: never = state.status;
      return unreachable;
    }
  }
}
