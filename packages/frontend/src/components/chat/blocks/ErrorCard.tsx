import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TurnErrorCode } from "@bg/shared";
import { apiErrorCopy } from "@/lib/error-copy";

export default function ErrorCard({
  code,
  recoverable,
}: {
  message: string;
  code?: TurnErrorCode;
  recoverable: boolean;
}) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-destructive">오류</div>
          <div className="text-destructive/80 mt-0.5 break-words">
            {apiErrorCopy({ code: code ?? "turn_failed" })}
          </div>
          {recoverable && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="메시지 입력"]')?.focus()}>
                <RefreshCw className="h-3 w-3" /> 메시지 입력으로 이동
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
