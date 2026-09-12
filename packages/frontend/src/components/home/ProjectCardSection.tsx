import { useT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { FolderOpen, Search } from "lucide-react";
import CardGrid from "./CardGrid";
import type { CardViewModel } from "./mappers";
import ProjectCard from "./ProjectCard";

interface ProjectCardSectionProps {
  readonly cards: readonly CardViewModel[];
  readonly sourceCount: number;
  readonly query: string;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly emptyText: string;
  readonly emptyHint: string;
  readonly onRetry: () => void;
  readonly onClearQuery: () => void;
  readonly onStartProject: () => void;
  readonly onDelete?: (card: CardViewModel) => void;
}

export default function ProjectCardSection({
  cards,
  sourceCount,
  query,
  isLoading,
  error,
  emptyText,
  emptyHint,
  onRetry,
  onClearQuery,
  onStartProject,
  onDelete,
}: ProjectCardSectionProps) {
  const t = useT();
  if (isLoading) {
    return (
      <div
        aria-live="polite"
        className="rounded-2xl border border-border bg-card px-6 py-14 text-center"
      >
        <p className="text-sm font-medium text-foreground">
          {t("home.projectsLoading")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("home.wait")}
        </p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-10 text-center"
      >
        <p className="text-sm font-medium text-foreground">
          {t("home.projectsError")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("home.serverRetry")}
        </p>
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          {t("home.retry")}
        </Button>
      </div>
    );
  }

  if (sourceCount === 0) {
    return (
      <div
        aria-live="polite"
        className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center"
      >
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><FolderOpen className="h-6 w-6" aria-hidden="true" /></span>
        <p className="text-base font-semibold text-foreground">{emptyText}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {emptyHint}
        </p>
        <Button className="mt-4" variant="cta" onClick={onStartProject}>
          {t("home.createTitle")}
        </Button>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div
        aria-live="polite"
        className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center"
      >
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><Search className="h-6 w-6" aria-hidden="true" /></span>
        <p className="text-sm font-medium text-foreground">
          {t("home.searchEmpty", { query: query.trim() })}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("home.clearSearchHint")}
        </p>
        <Button className="mt-4" variant="outline" onClick={onClearQuery}>
          {t("home.clearSearch")}
        </Button>
      </div>
    );
  }

  return (
    <CardGrid>
      {cards.map((card) => (
        <ProjectCard
          key={card.id}
          {...card}
          onDelete={onDelete ? () => onDelete(card) : undefined}
        />
      ))}
    </CardGrid>
  );
}
