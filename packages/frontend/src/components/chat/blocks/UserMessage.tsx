import { Paperclip, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const canRevert = Boolean(turnId && onRevert);
  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="max-w-[94%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md border border-primary/15 bg-primary/5 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
        {text}
        {attachmentCount && attachmentCount > 0 ? (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Paperclip className="h-3 w-3" aria-hidden="true" /> 첨부 파일 {attachmentCount}개
          </div>
        ) : null}
      </div>
      {canRevert && (
        <button
          type="button"
          onClick={() => {
            if (!turnId || !onRevert || reverting) return;
            const ok = window.confirm(
              "이 턴 이전 상태로 되돌릴까요? 이후 변경된 파일은 사라져요.",
            );
            if (ok) onRevert(turnId);
          }}
          disabled={reverting}
          title="이 턴 이전 상태로 되돌리기"
          className={cn(
            "inline-flex min-h-7 items-center justify-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11",
            reverting && "opacity-100 animate-pulse",
          )}
        >
          <RotateCcw className="h-3 w-3" />
          <span>이 턴 되돌리기</span>
        </button>
      )}
    </div>
  );
}
