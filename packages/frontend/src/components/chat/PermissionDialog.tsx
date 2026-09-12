import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { t as translate, useT } from "@/i18n/t";

export interface PermissionRequest {
  toolCallId: string;
  tool: string;
  input: unknown;
}

/**
 * Modal surfaced when a `tool.permission_required` event arrives.
 * Allow/Deny dispatch `user.tool_decision`; Deny aborts the active
 * turn server-side so the CLI exits cleanly.
 */
export default function PermissionDialog({
  request,
  pending,
  onDecide,
}: {
  request: PermissionRequest | null;
  pending: boolean;
  onDecide: (decision: "allow" | "deny") => void;
}) {
  const t = useT();
  const open = request !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending && request) onDecide("deny");
      }}
    >
      <DialogContent
        className="max-w-md"
        hideClose
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-md bg-amber-500/10 text-amber-600">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <DialogTitle>{t("chat.permission.title")}</DialogTitle>
          <DialogDescription>{t("chat.permission.description")}</DialogDescription>
        </DialogHeader>

        {request && (
          <div className="rounded-md border border-border bg-muted/40 text-xs">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("chat.permission.tool")}
              </span>
              <span className="truncate font-mono">{request.tool}</span>
            </div>
            <div className="border-b border-border px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("chat.permission.input")}
              </div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                {formatInput(request.input)}
              </pre>
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("chat.permission.callId")}
              </span>
              <span className="truncate font-mono text-muted-foreground">
                {request.toolCallId}
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="pt-2 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => onDecide("deny")}
            disabled={pending}
          >
            {t("chat.permission.deny")}
          </Button>
          <Button
            variant="default"
            onClick={() => onDecide("allow")}
            disabled={pending}
          >
            {pending ? t("chat.permission.sending") : t("chat.permission.allow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatInput(input: unknown): string {
  if (input == null) return translate("chat.permission.noInput");
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
