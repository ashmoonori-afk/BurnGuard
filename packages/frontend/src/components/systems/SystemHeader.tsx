import type { DesignSystemSummary } from "@bg/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/i18n/t";

const STATUS_LABELS = {
  draft: "system.status.draft",
  review: "system.status.review",
  published: "system.status.published",
} as const satisfies Record<DesignSystemSummary["status"], MessageKey>;

export default function SystemHeader({ system }: { system: DesignSystemSummary }) {
  const t = useT();
  return (
    <header className="border-b border-border bg-background px-8 py-4 flex items-center gap-3 shrink-0">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground uppercase tracking-wider">
          {t("system.title")}
        </div>
        <h1 className="text-lg font-semibold truncate">{system.name}</h1>
      </div>
      <Badge
        variant={system.status === "published" ? "accent" : "outline"}
        className="uppercase tracking-wider"
      >
        {t(STATUS_LABELS[system.status])}
      </Badge>
      {system.is_template && <Badge variant="outline">{t("system.template")}</Badge>}
      {system.status === "review" && (
        <Button variant="cta" size="sm">
          {t("system.publish")}
        </Button>
      )}
    </header>
  );
}
