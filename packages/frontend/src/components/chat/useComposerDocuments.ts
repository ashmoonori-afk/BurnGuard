import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { preserveSessionDocuments } from "@/api/session";
import type { IntakeItem } from "./attachment-intake";

/** Saving originals does not select them for an AI turn or delete prior documents. */
export function useComposerDocuments(sessionId: string, ready: boolean, items: readonly IntakeItem[]) {
  const queryClient = useQueryClient();
  const files = useMemo(() => items.filter((item) => item.status === "ready"), [items]);
  const key = JSON.stringify([sessionId, files.map((item) => item.id)]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; status: "saved" | "error" } | null>(null);
  useEffect(() => {
    if (!ready || files.length === 0) return;
    let active = true;
    setResult(null);
    void preserveSessionDocuments(sessionId, files.map((item) => item.file)).then(() => {
      // Refresh even if selection changed while saving: the originals still exist.
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "project" && query.queryKey[2] === "files" });
      if (active) setResult({ key, status: "saved" });
    }).catch(() => {
      if (active) setResult({ key, status: "error" });
    });
    return () => { active = false; };
  }, [sessionId, ready, files, key, attempt, queryClient]);
  const status = files.length === 0 ? "empty" : result?.key === key ? result.status : "saving";
  return { status, canSend: status === "empty" || status === "saved", retry: () => { setResult(null); setAttempt((value) => value + 1); } };
}
