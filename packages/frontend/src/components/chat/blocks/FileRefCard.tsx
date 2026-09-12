import { FilePlus, FileEdit, FileMinus, ExternalLink } from "lucide-react";
import { useT, type MessageKey } from "@/i18n/t";

type FileAction = "created" | "edited" | "deleted";

const FILE_ACTION_MESSAGE_KEYS: Record<FileAction, MessageKey> = {
  created: "chat.file.created",
  edited: "chat.file.edited",
  deleted: "chat.file.deleted",
};

export default function FileRefCard({
  path,
  action,
  onClick,
}: {
  path: string;
  action: FileAction;
  onClick?: () => void;
}) {
  const t = useT();
  const Icon =
    action === "created"
      ? FilePlus
      : action === "edited"
        ? FileEdit
        : FileMinus;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(FILE_ACTION_MESSAGE_KEYS[action], { name: path })}
      className="group w-full flex items-center gap-2 rounded-md border border-border bg-background hover:bg-muted px-2.5 py-1.5 text-xs"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="font-mono truncate flex-1 text-left">{path}</span>
      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
    </button>
  );
}
