import { AlertTriangle, ExternalLink } from "lucide-react";
import type { BackendDetectionResult } from "@bg/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BACKEND_INSTALL_URLS, BACKEND_PROBE_COMMANDS, backendLabel, backendProbeState } from "@/lib/backend-display";
import { useT } from "@/i18n/t";

/** One row per detected CLI, named by its product display name rather than its id. */
export function DetectionList({ detection }: { detection: BackendDetectionResult }) {
  const t = useT();
  return (
    <ul className="space-y-2 py-2">
      {detection.backends.map((b) => {
        const state = backendProbeState(b);
        const url = BACKEND_INSTALL_URLS[b.id];
        return (
          <li key={b.id} data-probe-state={state} className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="shrink-0 whitespace-nowrap font-medium">
                {backendLabel(b.id)}
              </span>
              <span className="text-xs text-muted-foreground">
                {state === "missing" ? t("errors.notFound") : state === "probe_failed" ? t("errors.probeFailed", { command: BACKEND_PROBE_COMMANDS[b.id] }) : t("errors.installed", { version: b.version ?? t("errors.healthy") })}
              </span>
            </div>
            {state !== "ready" && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent inline-flex items-center gap-1 mt-1"
              >
                <ExternalLink className="h-3 w-3" /> {t("errors.installGuide")}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function CliMissingModal({
  open,
  onOpenChange,
  detection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detection: BackendDetectionResult;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="h-10 w-10 rounded-md bg-destructive/10 text-destructive grid place-items-center mb-3">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle>{t("errors.cliMissing")}</DialogTitle>
          <DialogDescription>
            {t("errors.cliRequired")}
          </DialogDescription>
        </DialogHeader>

        <DetectionList detection={detection} />

        <DialogFooter className="pt-2 border-t border-border">
          <Button onClick={() => onOpenChange(false)}>{t("errors.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
