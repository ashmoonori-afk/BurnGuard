import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotebookPen } from "lucide-react";
import { MAX_PROJECT_INSTRUCTIONS_CHARS } from "@bg/shared";
import { getProjectInstructions, saveProjectInstructions } from "@/api/project";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/t";
import { apiErrorCopy } from "@/lib/error-copy";
import { useUIStore } from "@/state/uiStore";

export const projectInstructionsQueryKey = (projectId: string) => ["projects", projectId, "instructions"] as const;

export default function ProjectInstructionsButton({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((state) => state.pushToast);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const query = useQuery({ queryKey: projectInstructionsQueryKey(projectId), queryFn: () => getProjectInstructions(projectId), retry: false });
  useEffect(() => { if (open) setDraft(query.data?.text ?? ""); }, [open, query.data?.text]);
  const save = useMutation({
    mutationFn: () => saveProjectInstructions(projectId, { text: draft }),
    onSuccess: (next) => {
      queryClient.setQueryData(projectInstructionsQueryKey(projectId), next);
      setOpen(false);
      pushToast({ tone: "success", title: t("workspace.instructions.saved") });
    },
    onError: (error) => pushToast({ tone: "error", title: t("workspace.instructions.failed"), body: apiErrorCopy(error) }),
  });
  const active = Boolean(query.data?.text);
  return (
    <>
      <Button variant="outline" size="sm" className="min-h-10 gap-2 px-3 max-[900px]:min-h-11" data-instructions-active={active ? "1" : "0"} onClick={() => setOpen(true)}>
        <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
        {t(active ? "workspace.instructions.buttonActive" : "workspace.instructions.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("workspace.instructions.title")}</DialogTitle>
            <DialogDescription>{t("workspace.instructions.help")}</DialogDescription>
          </DialogHeader>
          <textarea
            aria-label={t("workspace.instructions.title")}
            className="min-h-48 w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed"
            maxLength={MAX_PROJECT_INSTRUCTIONS_CHARS}
            placeholder={t("workspace.instructions.placeholder")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="text-right text-xs text-muted-foreground">{draft.length} / {MAX_PROJECT_INSTRUCTIONS_CHARS}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("workspace.instructions.cancel")}</Button>
            <Button disabled={save.isPending || query.isPending} onClick={() => save.mutate()}>{t("workspace.instructions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
