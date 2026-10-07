import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCatalogT, useT } from "@/i18n/t";
import { cn } from "@/lib/utils";
import {
  filterPromptLibrary,
  PROMPT_LIBRARY_CATEGORIES,
  promptMessageKey,
  type LoadedPromptLibrary,
  type PromptLibraryCategory,
  type PromptLibraryEntry,
} from "@/lib/prompt-library";

type CategoryFilter = PromptLibraryCategory | "all";
const FILTERS: readonly CategoryFilter[] = ["all", ...PROMPT_LIBRARY_CATEGORIES];

export default function PromptLibraryDialog({
  open,
  onOpenChange,
  library,
  status,
  onInsert,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: LoadedPromptLibrary | undefined;
  status: "pending" | "error" | "success";
  onInsert: (entry: PromptLibraryEntry) => void;
  /** The opener is not a DialogTrigger, so the caller decides where focus lands once the dialog closes. */
  onCloseAutoFocus: (event: Event) => void;
}) {
  const translate = useT();
  const catalogT = useCatalogT(library?.messages);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const results = useMemo(() => (library === undefined ? [] : filterPromptLibrary(library, category, query)), [library, category, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-qa="prompt-library" onCloseAutoFocus={onCloseAutoFocus} className="flex max-h-[min(44rem,calc(100dvh-2rem))] max-w-3xl flex-col gap-3 overflow-hidden">
        <DialogHeader className="pr-10">
          <DialogTitle>{translate("prompts.library.title")}</DialogTitle>
          <DialogDescription>{translate("prompts.library.description")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("prompts.library.search")}
            aria-label={translate("prompts.library.search")}
            className="pl-9"
          />
        </div>
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
          <legend className="sr-only">{translate("prompts.library.categories")}</legend>
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              data-prompt-category={filter}
              aria-pressed={category === filter}
              onClick={() => setCategory(filter)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                category === filter ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {translate(`prompts.category.${filter}`)}
            </button>
          ))}
        </fieldset>
        {status === "pending" && <p role="status" className="text-sm text-muted-foreground">{translate("prompts.library.loading")}</p>}
        {status === "error" && <p role="alert" className="text-sm text-destructive">{translate("prompts.library.loadError")}</p>}
        {library !== undefined && (
          <>
            <p role="status" className="text-xs text-muted-foreground">{translate("prompts.library.count", { count: results.length })}</p>
            <ul className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1">
              {results.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">{translate("prompts.library.empty")}</li>}
              {results.map((entry) => {
                const title = catalogT(promptMessageKey(entry.id, "title")) ?? entry.id;
                return (
                  <li key={entry.id} data-prompt-id={entry.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{catalogT(promptMessageKey(entry.id, "summary"))}</p>
                        <p className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                          <span className="rounded-md bg-muted px-1.5 py-0.5">{translate(`prompts.category.${entry.category}`)}</span>
                          {entry.aspect !== null && <span className="rounded-md bg-muted px-1.5 py-0.5">{translate("prompts.library.aspect", { aspect: entry.aspect })}</span>}
                        </p>
                      </div>
                      <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-3 text-xs" aria-label={translate("prompts.library.insertNamed", { title })} onClick={() => onInsert(entry)}>
                        {translate("prompts.library.insert")}
                      </Button>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">{translate("prompts.library.preview")}</summary>
                      <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 font-sans text-[11px] leading-relaxed text-foreground">{entry.prompt}</pre>
                    </details>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
