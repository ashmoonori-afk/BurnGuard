import { useEffect, useState, type ReactNode } from "react";
import { bootstrapApiAuthority } from "@/api/client";

/** Render recovery before API consumers mount, including while bootstrap is offline. */
export default function Bootstrap({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState("loading");
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void bootstrapApiAuthority(controller.signal).then(
      () => { if (active) setState("ready"); },
      () => { if (active) setState("error"); },
    ).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt]);
  if (state === "ready") return children;
  return <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
    <div className="max-w-md space-y-4 text-center" role={state === "error" ? "alert" : "status"}>
      <h1 className="text-xl font-semibold">BurnGuard</h1>
      <p>{state === "loading" ? "작업 공간을 준비하고 있어요…" : "로컬 서버에 연결하지 못했어요. BurnGuard가 실행 중인지 확인한 뒤 다시 시도해 주세요."}</p>
      {state === "error" && <button type="button" className="rounded-md bg-primary px-4 py-3 text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setAttempt((value) => value + 1)}>다시 연결</button>}
    </div>
  </main>;
}
