import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n/t";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function DeleteProjectDialog({
  open,
  onOpenChange,
  projectName,
  onConfirm,
  isPending,
  onCloseFallbackFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  onConfirm: () => void;
  isPending?: boolean;
  /** Where focus goes when the opener (a card menu) was removed by the delete itself. */
  onCloseFallbackFocus?: () => void;
}) {
  const t = useT();
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={() => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) return;
          event.preventDefault();
          onCloseFallbackFocus?.();
        }}
      >
        <DialogHeader>
          <div className="h-10 w-10 rounded-md bg-destructive/10 text-destructive grid place-items-center mb-3">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle className="break-keep leading-snug">
            {t("home.deleteProjectTitle", { name: projectName })}
          </DialogTitle>
          <DialogDescription className="break-keep">
            {t("home.deleteProjectDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-2 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("home.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? t("home.deleting") : t("home.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
