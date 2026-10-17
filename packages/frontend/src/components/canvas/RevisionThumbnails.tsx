import { useEffect, useState } from "react";
import { useT } from "@/i18n/t";
import { resolveThumbnailSource, thumbnailRetryDelay } from "@/components/home/thumbnail-source";
import type { RevisionThumbnailUrls } from "./revision-thumbnail-source";

export default function RevisionThumbnails({ sources }: { readonly sources: RevisionThumbnailUrls }) {
  const t = useT();
  return <span data-qa="revision-thumbnails" className="mt-2 grid min-w-0 grid-cols-2 gap-2">
    <RevisionThumbnail key={sources.before ?? "missing-before"} source={sources.before} label={t("revision.before")} />
    <RevisionThumbnail key={sources.after ?? "missing-after"} source={sources.after} label={t("revision.after")} />
  </span>;
}

function RevisionThumbnail({ source, label }: { readonly source: string | null; readonly label: string }) {
  const t = useT();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resolved = resolveThumbnailSource(source, failedSource);
  const delay = thumbnailRetryDelay(attempt);
  useEffect(() => {
    if (!source || source !== failedSource || delay === null) return;
    const timer = setTimeout(() => { setAttempt(value => value + 1); setFailedSource(null); }, delay);
    return () => clearTimeout(timer);
  }, [source, failedSource, delay]);
  return <span className="block min-w-0">
    <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
    <span className="grid aspect-video w-full place-items-center overflow-hidden rounded border border-border bg-muted">
      {resolved ? <img src={resolved} alt={label} width={640} height={360} loading="lazy" decoding="async" className="h-full w-full object-contain" onError={() => setFailedSource(resolved)} />
        : <span className="p-2 text-center text-xs text-muted-foreground">{source ? t(delay === null ? "home.previewError" : "home.previewPreparing") : t("home.previewEmpty")}</span>}
    </span>
  </span>;
}
