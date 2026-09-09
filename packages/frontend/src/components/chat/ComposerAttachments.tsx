import { Paperclip } from "lucide-react";
import type { VisualSourceRole } from "@bg/shared";
import { cn } from "@/lib/utils";
import type {
  IntakeItem,
  IntakeRejection,
} from "./attachment-intake";

interface ComposerAttachmentsProps {
  readonly items: readonly IntakeItem[];
  readonly sending: boolean;
  readonly onRemove: (id: string) => void;
  readonly onRoleChange: (id: string, role: VisualSourceRole) => void;
}

export default function ComposerAttachments({
  items,
  sending,
  onRemove,
  onRoleChange,
}: ComposerAttachmentsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul
      className="mb-2 max-h-44 space-y-2 overflow-y-auto"
      aria-label="첨부 목록"
      aria-busy={sending}
      aria-live="polite"
    >
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs",
            item.status === "ready"
              ? "bg-muted text-muted-foreground"
              : "bg-destructive/10 text-destructive",
          )}
        >
          <Paperclip className="h-3 w-3" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium" title={item.file.name}>{item.file.name}</span>
          {item.status === "ready" ? (
            <select
              value={item.role}
              disabled={sending}
              onChange={(event) => onRoleChange(item.id, event.target.value === "immutable_reference" ? "immutable_reference" : "ordinary_content")}
              aria-label={`${item.file.name} 역할`}
              className="order-last w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent max-[900px]:min-h-11"
            >
              <option value="ordinary_content">일반 자료</option>
              <option value="immutable_reference">수정하지 않는 시각 참조</option>
            </select>
          ) : (
            <span className="opacity-90">{rejectionLabel(item.reason)}</span>
          )}
          <button
            type="button"
            className="ml-0.5 min-h-7 min-w-7 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 max-[900px]:min-h-11 max-[900px]:min-w-11"
            aria-label={`${item.file.name} 첨부 취소`}
            disabled={sending}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function rejectionLabel(reason: IntakeRejection): string {
  switch (reason) {
    case "unsupported_kind":
      return "지원하지 않는 형식";
    case "too_large":
      return "파일당 10MB 초과";
    case "count_exceeded":
      return "최대 8개까지";
    case "total_exceeded":
      return "전체 25MB 초과";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}
