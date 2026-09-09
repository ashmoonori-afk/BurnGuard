import type { DesignDirectionState } from "@bg/shared";
import { Check, Compass, RotateCcw, StopCircle } from "lucide-react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { DirectionCard } from "./DirectionCard";
import { directionActions, directionProgress } from "@/lib/design-direction-state";

type DirectionsViewProps = {
  readonly state: DesignDirectionState | null;
  readonly recovering: boolean;
  readonly actionPending: boolean;
  readonly cancelPending: boolean;
  readonly error: Error | null;
  readonly onGenerate: () => void;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onSelect: (directionId: string) => void;
  readonly onUndo: () => void;
};

export function DirectionsView({
  state,
  recovering,
  actionPending,
  cancelPending,
  error,
  onGenerate,
  onCancel,
  onRetry,
  onSelect,
  onUndo,
}: DirectionsViewProps) {
  const actions = directionActions(state);
  const selected =
    state?.directions.find((direction) => direction.id === state.selected_id) ?? null;

  if (recovering && state === null) {
    return (
      <DirectionShell busy>
        <div className="grid min-h-full place-items-center px-4 text-sm text-muted-foreground">
          저장된 디자인 방향을 불러오고 있어요.
        </div>
      </DirectionShell>
    );
  }

  if (state === null) {
    return (
      <DirectionShell busy={actionPending}>
        <div className="grid min-h-full place-items-center px-4 py-12 text-center">
          <div className="max-w-lg rounded-2xl border border-border bg-card px-6 py-10 shadow-sm sm:px-10">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent/10"><Compass className="h-7 w-7 text-accent" aria-hidden="true" /></div>
            <h1 className="text-xl font-semibold tracking-tight">프로젝트의 디자인 방향을 정해요</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground [word-break:keep-all]">
              현재 콘텐츠를 바탕으로 서로 다른 구성과 스타일의 미리보기 3개를 만들어요.
            </p>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">미리보기를 비교하고 원하는 방향을 선택하면 다음 AI 생성에 반영돼요.</p>
            <Button
              type="button"
              variant="cta"
              className="mt-6 min-h-11"
              disabled={actionPending}
              onClick={onGenerate}
            >
              방향 3개 생성
            </Button>
            <DirectionError error={error} />
          </div>
        </div>
      </DirectionShell>
    );
  }

  const progress = directionProgress(state);
  const loading = state.status === "loading";

  return (
    <DirectionShell busy={loading || actionPending}>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-7">
        <header className="flex items-start justify-between gap-4 max-[600px]:flex-col">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">디자인 방향</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground [word-break:keep-all]">
              {stateSummary(state, progress.resolved)}
            </p>
          </div>
          {loading ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={cancelPending || !actions.canCancel}
              onClick={onCancel}
            >
              <StopCircle aria-hidden="true" />
              {cancelPending ? "취소 요청 중" : "생성 취소"}
            </Button>
          ) : actions.canRetry ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={actionPending}
              onClick={onRetry}
            >
              <RotateCcw aria-hidden="true" />
              실패한 방향 모두 다시 만들기
            </Button>
          ) : null}
        </header>

        {!loading ? <ContentOutline items={state.content_outline} /> : null}

        <section
          className="mt-6 grid min-w-0 grid-cols-3 gap-5 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1"
          aria-label="디자인 방향 후보"
        >
          {state.directions.map((direction) => (
            <DirectionCard
              key={direction.id}
              direction={direction}
              selected={state.selected_id === direction.id}
              selectable={actions.canSelect && !actionPending}
              onSelect={onSelect}
            />
          ))}
        </section>

        {!loading ? (
          <div className="mt-5 flex min-h-14 items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2 max-[600px]:flex-wrap">
            <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm [word-break:keep-all]">
              {selected === null
                ? "선택한 방향이 없어요."
                : `선택한 방향: ${selected.title} · 다음 생성에 이 방향을 적용해요.`}
            </p>
            {actions.canUndo ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 shrink-0"
                disabled={actionPending}
                onClick={onUndo}
              >
                선택 되돌리기
              </Button>
            ) : null}
          </div>
        ) : null}
        <DirectionError error={error} />
      </div>
    </DirectionShell>
  );
}

function DirectionShell({
  busy,
  children,
}: {
  readonly busy: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <main
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted/30"
      aria-busy={busy}
    >
      {children}
    </main>
  );
}

function ContentOutline({ items }: { readonly items: readonly string[] }) {
  return (
    <section className="mt-5 rounded-lg border border-border bg-muted/50 p-4">
      <h2 className="text-xs font-medium text-muted-foreground">콘텐츠 구성</h2>
      <ol className="mt-2 grid gap-1 text-sm min-[1000px]:grid-cols-2">
        {items.map((item, index) => (
          <li
            key={`${index}-${item}`}
            className="min-w-0 break-words [word-break:keep-all]"
          >
            <span className="mr-2 font-mono text-xs text-muted-foreground">{index + 1}</span>
            {item}
          </li>
        ))}
      </ol>
    </section>
  );
}

function stateSummary(state: DesignDirectionState, resolved: number): string {
  switch (state.status) {
    case "loading":
      return `3개 중 ${resolved}개 준비됨 · 완료된 방향부터 바로 확인할 수 있어요.`;
    case "ready":
      return "3개 방향이 모두 준비됐어요. 비교한 뒤 하나를 선택하세요.";
    case "partial":
      return "준비된 방향은 선택할 수 있어요. 실패한 방향은 한 번에 다시 만들 수 있어요.";
    case "failed":
      return "방향을 만들지 못했어요. 잠시 후 모두 다시 시도하세요.";
    case "cancelled":
      return "생성을 취소했어요. 이미 준비된 방향은 계속 선택할 수 있어요.";
    default: {
      const unreachable: never = state.status;
      return unreachable;
    }
  }
}

function DirectionError({ error }: { readonly error: Error | null }) {
  if (error === null) return null;
  return (
    <p role="alert" className="mt-4 text-sm text-destructive">
      {boundedError(error)}
    </p>
  );
}

function boundedError(error: Error): string {
  if (!(error instanceof ApiError)) return "요청을 처리하지 못했어요. 잠시 후 다시 시도하세요.";
  if (error.code === "session_busy") return "채팅 작업이 끝난 뒤 다시 시도하세요.";
  if (error.code === "operation_active" || error.code === "generation_conflict") {
    return "이미 디자인 방향을 만들고 있어요.";
  }
  if (error.code === "revision_conflict") return "선택 상태가 바뀌었어요. 최신 상태에서 다시 시도하세요.";
  if (error.code === "operation_not_active") return "이미 생성 작업이 끝났어요.";
  return "디자인 방향 요청을 처리하지 못했어요. 잠시 후 다시 시도하세요.";
}
