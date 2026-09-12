import { useT } from "@/i18n/t";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Palette } from "lucide-react";
import { getProjectPalette, patchProjectPalette } from "@/api/project-palette";
import { apiErrorCopy } from "@/lib/error-copy";
import { isStaleIdentityError } from "@/lib/artifact-identity";

export default function ColorPalette({ projectId, relPath, refreshKey, disabled, onSaved }: {
  projectId: string;
  relPath: string;
  refreshKey: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const palette = useQuery({
    queryKey: ["project", projectId, "palette", relPath, refreshKey],
    queryFn: () => getProjectPalette(projectId, relPath),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: ({ color, value }: { color: string; value: string }) => {
      if (!palette.data) throw new Error("palette_unavailable");
      return patchProjectPalette(projectId, {
        rel_path: relPath,
        expected_revision: palette.data.revision,
        expected_artifact_digest: palette.data.artifact_digest,
        color,
        value,
      });
    },
    onSuccess: () => { onSaved(); void palette.refetch(); },
    onError: (error) => { if (isStaleIdentityError(error)) void palette.refetch(); },
  });
  return <div className="relative">
    <button type="button" title={t("canvas.palette.title")} aria-expanded={open} aria-label={t("canvas.palette.title")} onClick={() => setOpen((value) => !value)} className="flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11">
      <Palette className="h-4 w-4" aria-hidden="true" /><span>{t("canvas.palette.trigger")}</span>
    </button>
    {open && <section aria-label={t("canvas.palette.currentPage")} className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[85vw] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}>
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t("canvas.palette.heading")}</h2><button type="button" className="text-xs text-muted-foreground" onClick={() => setOpen(false)}>{t("canvas.palette.close")}</button></div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("canvas.palette.description")}</p>
      {palette.isLoading && <p role="status" className="text-xs">{t("canvas.palette.loading")}</p>}
      {palette.error && <p role="alert" className="text-xs text-destructive">{apiErrorCopy(palette.error)} <button type="button" className="underline" onClick={() => void palette.refetch()}>{t("canvas.palette.retry")}</button></p>}
      {palette.data && <div className="max-h-72 space-y-2 overflow-y-auto">
        {palette.data.colors.length === 0 && <p className="text-xs text-muted-foreground">{t("canvas.palette.empty")}</p>}
        {palette.data.colors.map((color) => <ColorRow key={`${palette.data.revision}:${color.id}`} name={color.name} value={color.value} count={color.count} disabled={disabled || save.isPending} onSave={(value) => save.mutate({ color: color.value, value })} />)}
      </div>}
      {save.isPending && <p role="status" className="mt-2 text-xs">{t("canvas.palette.applying")}</p>}
      {save.error && <p role="alert" className="mt-2 text-xs text-destructive">{isStaleIdentityError(save.error) ? t("canvas.palette.stale") : apiErrorCopy(save.error)}</p>}
    </section>}
  </div>;
}

function ColorRow({ name, value, count, disabled, onSave }: { name: string; value: string; count: number; disabled: boolean; onSave: (value: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  return <form onSubmit={(event) => { event.preventDefault(); if (valid && !disabled && draft.toLowerCase() !== value.toLowerCase()) onSave(draft); }} className="rounded-lg border border-border p-2">
    <div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="truncate" title={name}>{name}</span><span className="shrink-0 text-muted-foreground">{t("canvas.palette.usageCount", { count })}</span></div>
    <div className="flex items-center gap-2">
      <input type="color" aria-label={t("canvas.palette.pickColor", { name })} value={valid ? draft : value} disabled={disabled} onChange={(event) => setDraft(event.target.value)} className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5" />
      <input type="text" aria-label={t("canvas.palette.colorCode", { name })} value={draft} maxLength={7} pattern="#[0-9A-Fa-f]{6}" disabled={disabled} onChange={(event) => setDraft(event.target.value)} className="h-9 min-w-0 flex-1 rounded border border-border bg-background px-2 font-mono text-xs" />
      <button type="submit" aria-label={t("canvas.palette.applyColor", { name })} disabled={disabled || !valid || draft.toLowerCase() === value.toLowerCase()} className="flex h-9 items-center gap-1 rounded bg-accent px-2 text-xs text-accent-foreground disabled:opacity-40"><Check className="h-3 w-3" aria-hidden="true" />{t("canvas.palette.apply")}</button>
    </div>
  </form>;
}
