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
  if (isLoading) {
    return (
      <div
        aria-live="polite"
        className="rounded-2xl border border-border bg-card px-6 py-14 text-center"
      >
        <p className="text-sm font-medium text-foreground">
          프로젝트를 불러오는 중이에요.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          잠시만 기다려 주세요.
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
          프로젝트를 불러오지 못했어요.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          로컬 서버가 켜져 있는지 확인한 뒤 다시 시도해 주세요.
        </p>
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          다시 시도
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
          새 프로젝트 만들기
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
          ‘{query.trim()}’에 대한 검색 결과가 없어요.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          검색어를 지우면 전체 목록으로 돌아가요.
        </p>
        <Button className="mt-4" variant="outline" onClick={onClearQuery}>
          검색어 지우기
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
