import { useState } from "react";
import { Paperclip, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { commentEditDisplayText } from "@/components/modes/comment-edit-request";
import { requestDisplayText } from "@/lib/request-display";
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

export default function UserMessage({
  text,
  attachmentCount,
  turnId,
  onRevert,
  reverting,
}: {
  text: string;
  attachmentCount?: number;
  turnId?: string;
  onRevert?: (turnId: string) => void;
  reverting?: boolean;
}) {
  const t = useT();
  const canRevert = Boolean(turnId && onRevert);
  // An in-app dialog: the macOS WKWebView shell answers native confirm() with Cancel.
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="max-w-[94%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md border border-primary/15 bg-primary/5 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
        {requestDisplayText(commentEditDisplayText(text))}
        {attachmentCount && attachmentCount > 0 ? (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Paperclip className="h-3 w-3" aria-hidden="true" /> {t("chat.user.attachments", { count: attachmentCount })}
          </div>
        ) : null}
      </div>
      {canRevert && (
        <button
          type="button"
          data-qa="turn-revert"
          onClick={() => {
            if (!turnId || !onRevert || reverting) return;
            setConfirming(true);
          }}
          disabled={reverting}
          title={t("chat.user.revertTitle")}
          className={cn(
            "inline-flex min-h-7 items-center justify-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11",
            reverting && "opacity-100 animate-pulse",
          )}
        >
          <RotateCcw className="h-3 w-3" />
          <span>{reverting ? t("chat.user.reverting") : t("chat.user.revert")}</span>
        </button>
      )}
      {canRevert && (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent className="max-w-md" data-qa="revert-confirm">
            <DialogHeader>
              <DialogTitle className="break-keep leading-snug">{t("chat.user.revertTitle")}</DialogTitle>
              <DialogDescription className="break-keep">{t("chat.user.revertConfirm")}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2 border-t border-border">
              <Button variant="ghost" data-qa="revert-cancel" onClick={() => setConfirming(false)}>
                {t("chat.user.revertCancel")}
              </Button>
              <Button
                variant="destructive"
                data-qa="revert-accept"
                onClick={() => {
                  setConfirming(false);
                  if (turnId && onRevert) onRevert(turnId);
                }}
              >
                {t("chat.user.revertAccept")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
