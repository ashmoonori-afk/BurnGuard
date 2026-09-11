import { useState } from "react";
import type { ArtifactHistoryV1 } from "@bg/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const labels: Record<string, string> = { initialize: "시작", patch: "편집", palette: "색상 변경", turn: "AI 작업", restore: "복원", undo: "실행 취소", external: "파일 변경" };
export default function ArtifactHistory({ history, disabled, onRestore }: { history: ArtifactHistoryV1 | null | undefined; disabled: boolean; onRestore: (operationId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState("");
  const entry = history?.entries.find(item => item.operation_id === selected);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" disabled={disabled || !history} className="h-9 shrink-0 rounded px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">저장 이력</button></DialogTrigger>
    <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>저장 시점으로 돌아가기</DialogTitle><DialogDescription>프로젝트 결과물 전체를 선택한 시점으로 복원해요. 현재 상태도 이력에 남으므로 다시 선택할 수 있어요. 첨부 원본과 대화는 유지됩니다.</DialogDescription></DialogHeader>
      <p className="text-sm">현재 리비전 {history?.current_revision} · Ctrl/Cmd+Z 취소 · Ctrl/Cmd+Shift+Z 다시 실행</p>
      <div className="max-h-[40vh] space-y-2 overflow-y-auto" aria-label="저장 시점 목록">{history?.entries.map(item => <button key={item.operation_id} type="button" aria-pressed={selected === item.operation_id} disabled={!item.available || disabled} onClick={() => setSelected(item.operation_id)} className={`w-full rounded border p-3 text-left text-sm disabled:opacity-50 ${selected === item.operation_id ? "border-accent bg-accent/10" : "border-border"}`}><strong>리비전 {item.revision} · {labels[item.kind] ?? "저장"}</strong><span className="mt-1 block text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()} · {item.available ? "복원 가능" : "보관 기간 만료"}</span></button>)}{history?.entries.length === 0 && <p className="text-sm text-muted-foreground">아직 이전 저장 시점이 없어요.</p>}</div>
      {entry && <p className="break-all text-xs text-muted-foreground">이 시점 이후 첫 변경 파일: {entry.files.slice(0, 6).join(", ")}{entry.files.length > 6 ? ` 외 ${entry.files.length - 6}개` : ""}</p>}
      <p className="text-xs text-muted-foreground">기록은 재실행 후에도 유지됩니다. 복원용 파일은 기본 30일간 보관됩니다.</p>
      <button type="button" disabled={disabled || !entry?.available} className="rounded bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-50" onClick={async () => { if (!entry) return; try { await onRestore(entry.operation_id); setOpen(false); setSelected(""); } catch { /* Parent displays the actionable mutation error. */ } }}>선택한 시점으로 복원</button>
    </DialogContent>
  </Dialog>;
}
