import { Eye, MessageSquare, MousePointer2, Paintbrush, Pencil, RefreshCw, ShieldCheck, SlidersHorizontal, Undo2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasMode } from "@/components/modes/types";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

const MODES: Array<{ id: CanvasMode; label: string; icon: LucideIcon; hint: string }> = [
  { id: "edit", label: "편집", icon: Pencil, hint: "요소를 눌러 텍스트·링크·이미지 설명을 수정해요." },
  { id: "tweaks", label: "스타일", icon: SlidersHorizontal, hint: "요소를 선택하고 색상·간격·글꼴을 조정해요." },
  { id: "comment", label: "코멘트", icon: MessageSquare, hint: "의견을 남길 위치를 누른 뒤 내용을 적어 주세요." },
  { id: "draw", label: "그리기", icon: Paintbrush, hint: "결과물 위에 자유롭게 표시해요. 그린 내용은 자동 저장돼요." },
  { id: "select", label: "선택", icon: MousePointer2, hint: "요소를 선택하면 구조와 스타일을 확인할 수 있어요." },
  { id: "quality", label: "품질 점검", icon: ShieldCheck, hint: "내보내기 전에 레이아웃과 접근성 문제를 확인해요." },
];

export default function CanvasTopBar({
  mode,
  onModeChange,
  onRefresh,
  canUndo = false,
  undoPending = false,
  onUndo,
  colorPalette,
}: {
  mode: CanvasMode | null;
  onModeChange: (m: CanvasMode | null) => void;
  onRefresh: () => void;
  /**
   * Whether the active file has a single-step undo entry available.
   * Audit fix #7: shows after any GUI patch (Edit / Tweaks save)
   * and clears once the undo runs or the next patch overwrites it.
   */
  canUndo?: boolean;
  undoPending?: boolean;
  onUndo?: () => void;
  colorPalette?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="grid flex-1 grid-cols-4 gap-1 min-[1400px]:flex" aria-label="캔버스 도구">
        <button type="button" onClick={() => onModeChange(null)} aria-pressed={mode === null} className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium max-[900px]:min-h-11", mode === null ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />미리보기</button>
        {MODES.map((m) => {
          const active = m.id === mode;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onModeChange(active ? null : m.id)}
              aria-pressed={active}
              title={active ? "다시 누르면 모드 끄기" : m.hint}
              className={cn(
                "flex min-h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{m.label}
            </button>
          );
        })}
        {colorPalette}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 max-[900px]:h-11 max-[900px]:w-11"
          aria-label="마지막 저장 실행 취소"
          onClick={onUndo}
          disabled={!canUndo || undoPending || !onUndo}
          title={
            canUndo
              ? "마지막 저장 실행 취소 (편집 / 스타일)"
              : "현재 파일에서 실행 취소할 수정이 없어요"
          }
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 max-[900px]:h-11 max-[900px]:w-11"
          aria-label="캔버스 새로고침"
          onClick={onRefresh}
          title="캔버스 새로고침"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      </div>
      {mode !== null && <p className="mt-2 border-t border-border/70 pt-2 text-xs leading-relaxed text-muted-foreground" role="status">{MODES.find((item) => item.id === mode)?.hint}</p>}
    </div>
  );
}
