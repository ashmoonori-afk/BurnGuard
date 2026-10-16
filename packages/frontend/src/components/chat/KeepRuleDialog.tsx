import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MAX_DESIGN_SYSTEM_RULE_CHARS, type DesignSystemRuleKind } from "@bg/shared";
import type { ProjectDesignSystemPin } from "@bg/shared/project";
import { apiFetch } from "@/api/client";
import { addDesignSystemRule } from "@/api/design-system";
import { appendProjectInstruction } from "@/api/project";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { projectInstructionsQueryKey } from "@/components/project/ProjectInstructionsButton";
import { ruleCandidateFromCorrection } from "@/lib/correction-rule";
import { apiErrorCopy } from "@/lib/error-copy";
import { useT } from "@/i18n/t";
import { useUIStore } from "@/state/uiStore";

export type KeepRuleSource = { readonly turnId: string; readonly text: string };
type Target = "system" | "project";

/**
 * Applies a saved system rule to this project's pinned baseline when the rule list is the only change, so the next turn
 * already follows it; any other pending system change keeps waiting for the user's explicit baseline update.
 */
async function applyRuleToPin(projectId: string): Promise<boolean> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/design-system-pin`;
  const pin = await apiFetch<ProjectDesignSystemPin | null>(url);
  if (!pin || pin.digest === pin.candidate_digest || pin.tokens_changed) return false;
  await apiFetch(url, { method: "POST", body: JSON.stringify({ expected_digest: pin.digest, candidate_digest: pin.candidate_digest }) });
  return true;
}

export default function KeepRuleDialog({ projectId, designSystemId, source, onClose }: {
  readonly projectId: string;
  readonly designSystemId: string | null;
  readonly source: KeepRuleSource | null;
  readonly onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((state) => state.pushToast);
  const [kind, setKind] = useState<DesignSystemRuleKind>("do");
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target>("project");
  useEffect(() => {
    if (source === null) return;
    const candidate = ruleCandidateFromCorrection(source.text);
    setKind(candidate.kind);
    setText(candidate.text);
    setTarget(designSystemId ? "system" : "project");
  }, [source, designSystemId]);
  const save = useMutation({
    mutationFn: async () => {
      if (source === null) return "none" as const;
      if (target === "system" && designSystemId) {
        await addDesignSystemRule(designSystemId, { kind, text, origin: { type: "correction", project_id: projectId, message_id: source.turnId } });
        return (await applyRuleToPin(projectId)) ? "system-applied" as const : "system-pending" as const;
      }
      const next = await appendProjectInstruction(projectId, { line: text });
      queryClient.setQueryData(projectInstructionsQueryKey(projectId), next);
      return "project" as const;
    },
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: ["design-systems"] });
      pushToast({ tone: "success", title: t(outcome === "system-pending" ? "chat.keepRule.savedPending" : "chat.keepRule.saved") });
      onClose();
    },
    onError: (error) => pushToast({ tone: "error", title: t("chat.keepRule.failed"), body: apiErrorCopy(error) }),
  });
  return (
    <Dialog open={source !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-qa="keep-rule-dialog">
        <DialogHeader>
          <DialogTitle>{t("chat.keepRule.title")}</DialogTitle>
          <DialogDescription>{t("chat.keepRule.help")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <select aria-label={t("chat.keepRule.kind")} className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={kind} onChange={(event) => setKind(event.target.value === "dont" ? "dont" : "do")}>
            <option value="do">{t("system.rules.do")}</option>
            <option value="dont">{t("system.rules.dont")}</option>
          </select>
          <select aria-label={t("chat.keepRule.target")} className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={target} onChange={(event) => setTarget(event.target.value === "system" && designSystemId ? "system" : "project")}>
            {designSystemId ? <option value="system">{t("chat.keepRule.targetSystem")}</option> : null}
            <option value="project">{t("chat.keepRule.targetProject")}</option>
          </select>
        </div>
        <textarea aria-label={t("chat.keepRule.text")} className="min-h-24 w-full resize-y rounded-md border border-border bg-background p-3 text-sm" maxLength={MAX_DESIGN_SYSTEM_RULE_CHARS} value={text} onChange={(event) => setText(event.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("chat.keepRule.cancel")}</Button>
          <Button data-qa="keep-rule-save" disabled={save.isPending || !text.trim()} onClick={() => save.mutate()}>{t("chat.keepRule.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
