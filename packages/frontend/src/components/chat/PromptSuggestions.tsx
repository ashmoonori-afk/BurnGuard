import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useCatalogT, useT } from "@/i18n/t";
import { promptMessageKey, suggestPrompts, type LoadedPromptLibrary, type PromptLibraryEntry } from "@/lib/prompt-library";

export default function PromptSuggestions({
  library,
  draft,
  disabled,
  onInsert,
}: {
  library: LoadedPromptLibrary | undefined;
  draft: string;
  disabled: boolean;
  onInsert: (entry: PromptLibraryEntry) => void;
}) {
  const translate = useT();
  const catalogT = useCatalogT(library?.messages);
  const deferredDraft = useDeferredValue(draft);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (draft.trim().length === 0) setDismissed(false);
  }, [draft]);
  const suggestions = useMemo(() => (library === undefined ? [] : suggestPrompts(deferredDraft, library)), [library, deferredDraft]);
  if (library === undefined || dismissed || suggestions.length === 0) return null;

  return (
    <div data-qa="prompt-suggestions" className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{translate("prompts.suggest.label")}</span>
      {suggestions.map((entry) => {
        const title = catalogT(promptMessageKey(entry.id, "title")) ?? entry.id;
        return (
          <button
            key={entry.id}
            type="button"
            data-prompt-id={entry.id}
            disabled={disabled}
            title={catalogT(promptMessageKey(entry.id, "summary"))}
            aria-label={translate("prompts.library.insertNamed", { title })}
            onClick={() => onInsert(entry)}
            className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
            <span className="truncate">{title}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={translate("prompts.suggest.dismiss")}
        title={translate("prompts.suggest.dismiss")}
        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
