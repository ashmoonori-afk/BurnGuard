import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useT } from "@/i18n/t";

export default function ThinkingBlock({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Sparkles className="h-3 w-3" />
        {t("chat.thinking")}
      </button>
      {open && (
        <div className="mt-1 pl-4 border-l border-border italic whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
