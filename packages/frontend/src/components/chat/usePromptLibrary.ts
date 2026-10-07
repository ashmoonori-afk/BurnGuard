import { useQuery } from "@tanstack/react-query";
import type { LoadedPromptLibrary } from "@/lib/prompt-library";

async function loadPromptLibrary(): Promise<LoadedPromptLibrary> {
  const [{ PROMPT_LIBRARY_ENTRIES }, { PROMPT_LIBRARY_COPY, PROMPT_LIBRARY_MESSAGES }] = await Promise.all([
    import("@/lib/prompt-library-entries"),
    import("@/i18n/prompt-library-copy"),
  ]);
  return { entries: PROMPT_LIBRARY_ENTRIES, copy: PROMPT_LIBRARY_COPY, messages: PROMPT_LIBRARY_MESSAGES };
}

/** The library is bundled but split into its own chunk, so the composer loads it once on first use. */
export function usePromptLibrary() {
  return useQuery({ queryKey: ["prompt-library"], queryFn: loadPromptLibrary, staleTime: Infinity });
}
