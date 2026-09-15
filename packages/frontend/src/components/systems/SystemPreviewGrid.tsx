import { Pencil } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { DesignSystemPreview } from "@bg/shared";
import { listDesignSystemPreviews } from "@/api/design-system";
import { apiErrorCopy } from "@/lib/error-copy";
import PreviewIframe from "./PreviewIframe";
import { Button } from "@/components/ui/button";
import { t, useT, type MessageKey } from "@/i18n/t";

interface PreviewSection {
  group: MessageKey;
  items: Array<{ id: string; title: MessageKey }>;
}

const WEBSITE_PREVIEW_PATH = "preview/website.html";

const SECTIONS: PreviewSection[] = [
  {
    group: "system.preview.slides",
    items: [{ id: "slides", title: "system.preview.slides" }],
  },
  {
    group: "system.preview.website",
    items: [{ id: "website", title: "system.preview.website" }],
  },
  {
    group: "system.preview.brand",
    items: [
      { id: "brand-logos", title: "system.preview.brandLogos" },
      { id: "brand-icons", title: "system.preview.brandIcons" },
    ],
  },
  {
    group: "system.colors",
    items: [
      { id: "colors-brand", title: "system.preview.brandColors" },
      { id: "colors-neutrals", title: "system.preview.neutrals" },
      { id: "colors-ramps", title: "system.preview.ramps" },
      { id: "colors-semantic", title: "system.preview.semantic" },
      { id: "colors-charts", title: "system.preview.charts" },
    ],
  },
  {
    group: "system.preview.typography",
    items: [
      { id: "type-display", title: "system.fontRole.display" },
      { id: "type-headings", title: "system.preview.headings" },
      { id: "type-body", title: "system.preview.body" },
    ],
  },
  {
    group: "system.preview.foundations",
    items: [
      { id: "spacing", title: "system.preview.spacing" },
      { id: "radii-shadows", title: "system.preview.radiiShadows" },
    ],
  },
  {
    group: "system.preview.components",
    items: [
      { id: "components-buttons", title: "system.preview.buttons" },
      { id: "components-cards", title: "system.preview.cards" },
      { id: "components-forms", title: "system.preview.forms" },
      { id: "components-badges-table", title: "system.preview.badgesTable" },
    ],
  },
];

export function groupSystemPreviews(previews: readonly DesignSystemPreview[]) {
  const known = new Map<string, { group: MessageKey; title: MessageKey }>(SECTIONS.flatMap((section) => section.items.map((item) => [
    `preview/${item.id}.html`, { group: section.group, title: item.title },
  ] as const)));
  const groups = new Map<string, Array<{ path: string; title: string }>>();
  const rank = (path: string) => path === WEBSITE_PREVIEW_PATH ? 0 : path === "preview/slides.html" ? 1 : 2;
  const ordered = [...previews].sort((a, b) => rank(a.path) - rank(b.path));
  for (const preview of ordered) {
    const metadata = known.get(preview.path);
    const group = t(metadata?.group ?? "system.preview.other");
    const title = metadata ? t(metadata.title) : preview.path.split("/").pop()!.replace(/\.html?$/i, "").replace(/[-_]/g, " ");
    const items = groups.get(group) ?? [];
    items.push({ path: preview.path, title });
    groups.set(group, items);
  }
  return Array.from(groups, ([group, items]) => ({ group, items }));
}

export default function SystemPreviewGrid({
  systemId,
  onEditColors,
  previewRefreshKey = 0,
}: {
  systemId: string;
  onEditColors?: () => void;
  previewRefreshKey?: number;
}) {
  const t = useT();
  const previewsQuery = useQuery({
    queryKey: ["design-systems", "previews", systemId, previewRefreshKey],
    queryFn: () => listDesignSystemPreviews(systemId), retry: false,
  });
  if (previewsQuery.isError) return <div role="alert" className="space-y-3 px-4 py-6 sm:px-8">
    <p className="text-sm font-medium">{t("system.preview.listFailed")}</p>
    <p className="text-sm text-muted-foreground">{apiErrorCopy(previewsQuery.error)}</p>
    <Button variant="outline" onClick={() => void previewsQuery.refetch()} disabled={previewsQuery.isFetching}>{previewsQuery.isFetching ? t("system.loading") : t("system.retry")}</Button>
  </div>;
  if (previewsQuery.isPending) return <p role="status" className="px-4 py-6 text-sm text-muted-foreground sm:px-8">{t("system.preview.checking")}</p>;
  const groups = groupSystemPreviews(previewsQuery.data);
  if (groups.length === 0) return <div role="status" className="px-4 py-6 text-sm text-muted-foreground sm:px-8">{t("system.preview.empty")}</div>;
  return (
    <div className="px-4 py-6 space-y-8 sm:px-8">
      {groups.map((grp, index) => (
        <section key={grp.group} className="grid gap-4 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,4fr)]">
          <h2 className="flex flex-col items-start gap-2 text-sm font-semibold">
            <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
            {grp.group}<span className="text-xs font-medium text-muted-foreground">{grp.items.length}</span>
          </h2>
          <div className={`grid min-w-0 grid-cols-1 gap-4 ${grp.items[0]?.path === WEBSITE_PREVIEW_PATH || grp.items[0]?.path === "preview/slides.html" ? "" : "lg:grid-cols-2"}`}>
            {grp.items.map((it) => (
              <article
                key={it.path}
                className="min-w-0 overflow-hidden border-b border-border bg-card pb-3"
              >
                <div className="mb-3">
                  <PreviewIframe
                    systemId={systemId}
                    path={it.path}
                    title={it.title}
                    refreshKey={previewRefreshKey}
                    website={it.path === WEBSITE_PREVIEW_PATH || it.path === "preview/slides.html"}
                  />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{it.title}</div>
                  </div>
                  {grp.group === t("system.colors") && onEditColors ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 px-3 text-xs"
                      onClick={onEditColors}
                    >
                      <Pencil className="h-3 w-3" />
                      {t("system.edit")}
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
