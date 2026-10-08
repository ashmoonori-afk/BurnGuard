import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useT } from "@/i18n/t";
import { listRecentlyDeletedProjects, restoreDeletedProject } from "@/api/home";
import { apiErrorCopy } from "@/lib/error-copy";
import { formatRelativeDay } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/state/uiStore";

/** Deleted projects kept for 30 days by the backend; hidden while empty so the tab stays unchanged for most users. */
export default function RecentlyDeletedSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const deletedQuery = useQuery({ queryKey: ["projects", "recently-deleted"], queryFn: listRecentlyDeletedProjects });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreDeletedProject(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      pushToast({ title: t("home.toast.projectRestored"), tone: "success" });
    },
    onError: async (err) => {
      await queryClient.invalidateQueries({ queryKey: ["projects", "recently-deleted"] });
      pushToast({ title: t("home.toast.projectRestoreError"), body: apiErrorCopy(err), tone: "error" });
    },
  });
  const projects = deletedQuery.data ?? [];
  if (projects.length === 0) return null;

  return (
    <section aria-labelledby="recently-deleted-title" className="mt-8 rounded-xl border border-border bg-card p-4">
      <h2 id="recently-deleted-title" className="text-sm font-semibold">{t("home.recentlyDeleted.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("home.recentlyDeleted.hint")}</p>
      <ul className="mt-3 divide-y divide-border">
        {projects.map((project) => {
          const restoring = restoreMutation.isPending && restoreMutation.variables === project.id;
          return (
            <li key={project.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
                <p className="text-xs text-muted-foreground">{t("home.recentlyDeleted.deletedOn", { date: formatRelativeDay(project.deleted_at) })}</p>
              </div>
              <Button size="sm" variant="outline" disabled={restoreMutation.isPending} aria-label={t("home.recentlyDeleted.restoreNamed", { name: project.name })} onClick={() => restoreMutation.mutate(project.id)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {restoring ? t("home.recentlyDeleted.restoring") : t("home.recentlyDeleted.restore")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
