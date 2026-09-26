import { useEffect, useState } from "react";
import { StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";
import { INTERRUPT_GRACE_MS } from "@/lib/session-event-state";

/**
 * Owns the one-second ticker so only this button re-renders while a turn runs.
 * 통제권 우선: 실행 중이면 5초 유예 뒤 항상 중단 가능. 턴 시작 시점에 체크포인트를
 * 뜨고 되돌리기가 있으므로 중단은 복구 가능한 동작이다.
 */
export default function InterruptButton({ busy, turnStartedAt, pending, onInterrupt }: {
  /** The composer is disabled by a running turn; idle composers never show Stop. */
  busy: boolean;
  turnStartedAt: number | null;
  pending: boolean;
  onInterrupt?: () => void;
}) {
  const t = useT();
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    setNowTs(Date.now());
    const handle = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [busy]);
  const elapsedMs = turnStartedAt === null ? null : Math.max(0, nowTs - turnStartedAt);
  if (!busy || elapsedMs === null || elapsedMs < INTERRUPT_GRACE_MS) return null;
  return (
    <Button
      variant="destructive"
      size="sm"
      className="h-9 gap-1.5 px-3 text-xs max-[900px]:h-11"
      disabled={pending || !onInterrupt}
      onClick={() => onInterrupt?.()}
      title={t("workspace.composer.interruptTitle")}
    >
      <StopCircle className="h-3.5 w-3.5" />
      {pending ? t("workspace.composer.interrupting") : t("workspace.composer.interruptElapsed", { time: formatElapsed(elapsedMs) })}
    </Button>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
