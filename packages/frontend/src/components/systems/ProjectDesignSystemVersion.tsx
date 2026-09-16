import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectDesignSystemPin } from "@bg/shared/project";
import { apiFetch } from "@/api/client";
import { apiErrorCopy } from "@/lib/error-copy";
import { useT } from "@/i18n/t";
import { Button } from "@/components/ui/button";

export default function ProjectDesignSystemVersion({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const t = useT();
  const client = useQueryClient();
  const url = `/api/projects/${encodeURIComponent(projectId)}/design-system-pin`;
  const queryKey = ["design-systems", "project-pin", projectId];
  const query = useQuery({ queryKey, queryFn: () => apiFetch<ProjectDesignSystemPin | null>(url) });
  const update = useMutation({
    mutationFn: (pin: ProjectDesignSystemPin) => apiFetch(url, { method: "POST", body: JSON.stringify({ expected_digest: pin.digest, candidate_digest: pin.candidate_digest }) }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  const pin = query.data;
  if (query.isError) return <p role="alert" className="p-4 text-sm">{apiErrorCopy(query.error)}</p>;
  if (!pin) return null;
  return <div className="space-y-2 border-b border-border bg-card p-4 text-sm">
    <p>{t("system.pin.current", { revision: pin.revision })}</p>
    <p className="text-muted-foreground">{t("system.pin.hint")}</p>
    {pin.digest !== pin.candidate_digest && <div className="space-y-2">
      <p>{t("system.pin.changed")}{pin.rules_changed ? ` · ${t("system.pin.rules")}` : ""}{pin.tokens_changed ? ` · ${t("system.pin.tokens")}` : ""}</p>
      <Button disabled={disabled || update.isPending} onClick={() => update.mutate(pin)}>{t("system.pin.apply")}</Button>
    </div>}
    {update.isError && <p role="alert">{apiErrorCopy(update.error)}</p>}
  </div>;
}
