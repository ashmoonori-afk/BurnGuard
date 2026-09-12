import { useQuery } from "@tanstack/react-query";
import { authorizedFetch, ApiError } from "@/api/client";
import { apiErrorCopy } from "@/lib/error-copy";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";
export default function PreviewIframe({
  systemId,
  path,
  title,
  refreshKey = 0,
}: {
  systemId: string;
  path: string;
  title?: string;
  refreshKey?: number;
}) {
  const t = useT();
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `/api/design-systems/${encodeURIComponent(systemId)}/files/${encodedPath}?v=${refreshKey}`;
  const previewQuery = useQuery({
    queryKey: ["design-systems", "preview-file", systemId, path, refreshKey],
    queryFn: async () => {
      const response = await authorizedFetch(url, { method: "HEAD" });
      if (!response.ok) throw new ApiError("design_system_preview_failed", "Preview unavailable", response.status);
      return url;
    },
    retry: false,
  });
  if (previewQuery.isError) return <div role="alert" className="grid aspect-video place-items-center rounded-md bg-muted p-3 text-center text-xs">
    <div className="space-y-2">
      <p>{previewQuery.error instanceof ApiError && previewQuery.error.status === 404 ? t("system.preview.missing") : t("system.preview.failed")}</p>
      <p className="text-muted-foreground">{apiErrorCopy(previewQuery.error)}</p>
      <Button size="sm" variant="outline" onClick={() => void previewQuery.refetch()} disabled={previewQuery.isFetching}>{t("system.retry")}</Button>
    </div>
  </div>;
  if (previewQuery.isPending) return <div role="status" className="grid aspect-video place-items-center rounded-md bg-muted text-xs text-muted-foreground">{t("system.preview.loading")}</div>;

  // The file URL preserves relative styles/images; scripts remain disabled.
  return (
    <iframe
      title={title ?? t("system.preview.title")}
      src={previewQuery.data}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      className="h-[280px] w-full rounded-lg border border-border bg-white sm:h-[320px]"
    />
  );
}
