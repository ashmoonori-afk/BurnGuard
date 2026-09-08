import { Pencil } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { DesignSystemPreview } from "@bg/shared";
import { listDesignSystemPreviews } from "@/api/design-system";
import { apiErrorCopy } from "@/lib/error-copy";
import PreviewIframe from "./PreviewIframe";
import { Button } from "@/components/ui/button";

interface PreviewSection {
  group: string;
  items: Array<{ id: string; title: string }>;
}

const SECTIONS: PreviewSection[] = [
  {
    group: "브랜드",
    items: [
      { id: "brand-logos", title: "브랜드 로고" },
      { id: "brand-icons", title: "브랜드 아이콘" },
    ],
  },
  {
    group: "색상",
    items: [
      { id: "colors-brand", title: "브랜드 색상" },
      { id: "colors-neutrals", title: "중립 색상" },
      { id: "colors-ramps", title: "전체 색상 단계" },
      { id: "colors-semantic", title: "의미 색상" },
      { id: "colors-charts", title: "차트 팔레트" },
    ],
  },
  {
    group: "타이포그래피",
    items: [
      { id: "type-display", title: "디스플레이" },
      { id: "type-headings", title: "제목" },
      { id: "type-body", title: "본문" },
    ],
  },
  {
    group: "기초",
    items: [
      { id: "spacing", title: "간격" },
      { id: "radii-shadows", title: "모서리 반경과 그림자" },
    ],
  },
  {
    group: "컴포넌트",
    items: [
      { id: "components-buttons", title: "버튼" },
      { id: "components-cards", title: "카드" },
      { id: "components-forms", title: "폼" },
      { id: "components-badges-table", title: "배지와 표" },
    ],
  },
];

export function groupSystemPreviews(previews: readonly DesignSystemPreview[]) {
  const known = new Map<string, { group: string; title: string }>(SECTIONS.flatMap((section) => section.items.map((item) => [
    `preview/${item.id}.html`, { group: section.group, title: item.title },
  ] as const)));
  const groups = new Map<string, Array<{ path: string; title: string }>>();
  for (const preview of previews) {
    const metadata = known.get(preview.path);
    const group = metadata?.group ?? "기타 미리보기";
    const title = metadata?.title ?? preview.path.split("/").pop()!.replace(/\.html?$/i, "").replace(/[-_]/g, " ");
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
  const previewsQuery = useQuery({
    queryKey: ["design-systems", "previews", systemId, previewRefreshKey],
    queryFn: () => listDesignSystemPreviews(systemId), retry: false,
  });
  if (previewsQuery.isError) return <div role="alert" className="space-y-3 px-4 py-6 sm:px-8">
    <p className="text-sm font-medium">미리보기 목록을 불러오지 못했어요.</p>
    <p className="text-sm text-muted-foreground">{apiErrorCopy(previewsQuery.error)}</p>
    <Button variant="outline" onClick={() => void previewsQuery.refetch()} disabled={previewsQuery.isFetching}>{previewsQuery.isFetching ? "불러오는 중…" : "다시 시도"}</Button>
  </div>;
  if (previewsQuery.isPending) return <p role="status" className="px-4 py-6 text-sm text-muted-foreground sm:px-8">미리보기를 확인하는 중이에요.</p>;
  const groups = groupSystemPreviews(previewsQuery.data);
  if (groups.length === 0) return <div role="status" className="px-4 py-6 text-sm text-muted-foreground sm:px-8">아직 미리보기 자료가 없어요. 위에서 색상과 글꼴을 확인할 수 있어요.</div>;
  return (
    <div className="px-4 py-6 space-y-8 sm:px-8">
      {groups.map((grp) => (
        <section key={grp.group}>
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            {grp.group}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grp.items.map((it) => (
              <article
                key={it.path}
                className="rounded-xl border border-border bg-card p-4 hover:shadow-app-2 transition-shadow"
              >
                <div className="mb-3">
                  <PreviewIframe
                    systemId={systemId}
                    path={it.path}
                    title={it.title}
                    refreshKey={previewRefreshKey}
                  />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{it.title}</div>
                  </div>
                  {grp.group === "색상" && onEditColors ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={onEditColors}
                    >
                      <Pencil className="h-3 w-3" />
                      편집
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
