import { useEffect } from "react";
import { Star, X } from "lucide-react";
import { useT } from "@/i18n/t";
import { hasOpenModal, STAR_PROMPT_REPO_URL } from "@/lib/star-prompt";
import { useUIStore } from "@/state/uiStore";

export default function StarPrompt() {
  const t = useT();
  const open = useUIStore((s) => s.starPromptOpen);
  const dismiss = useUIStore((s) => s.dismissStarPrompt);
  const owed = useUIStore((s) => s.starPromptOwed);
  const reveal = useUIStore((s) => s.revealStarPrompt);
  // Reveal once no modal menu or dialog is open; DOM mutations signal when one closes.
  useEffect(() => {
    if (!owed) return;
    const attempt = () => reveal(() => window.localStorage, hasOpenModal(document));
    attempt();
    const observer = new MutationObserver(attempt);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
    return () => observer.disconnect();
  }, [owed, reveal]);
  return (
    <div role="status" aria-live="polite">
      {open && (
        <aside
          data-star-prompt
          aria-labelledby="bg-star-prompt-title"
          className="fixed bottom-4 left-4 z-toast w-[min(20rem,calc(100vw-2rem))] rounded-md border border-accent/40 bg-background p-3 shadow-app-3"
        >
          <div className="flex items-start gap-2">
            <Star className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p id="bg-star-prompt-title" className="text-sm font-medium">{t("shell.starPrompt.title")}</p>
              <p className="mt-0.5 text-pretty break-keep text-xs text-muted-foreground">{t("shell.starPrompt.body")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={STAR_PROMPT_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={dismiss}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Star className="h-3 w-3" aria-hidden="true" />
                  {t("shell.starPrompt.action")}
                </a>
                <button
                  type="button"
                  onClick={dismiss}
                  className="min-h-8 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("shell.starPrompt.later")}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="-mr-1.5 -mt-1.5 grid min-h-9 min-w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("shell.close")}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
