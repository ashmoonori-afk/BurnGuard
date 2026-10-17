import { parseEditScope, type EditScope, type EditScopeMode } from "@bg/shared";
import { useT } from "@/i18n/t";

export interface EditScopeFieldsProps {
  readonly value?: EditScope;
  readonly onChange: (scope: EditScope) => void;
}

export default function EditScopeFields({ value, onChange }: EditScopeFieldsProps) {
  const t = useT();
  const scope = value ?? { mode: "unrestricted" };
  const targets = scope.targets?.map(target => [target.rel_path, target.artboard_id ?? "", target.node_id ?? ""].join(",")).join("\n") ?? "";
  let valid = true;
  try { parseEditScope(scope); } catch { valid = false; }
  return <div className="space-y-2" data-qa="edit-scope">
    <label className="block">{t("revision.scope")}
      <select aria-label={t("revision.scope")} className="mt-1 min-h-9 w-full rounded-lg border border-border bg-background px-2 text-xs" value={scope.mode} onChange={event => {
        const mode = event.target.value as EditScopeMode;
        onChange(mode === "unrestricted" ? { mode } : { ...scope, mode });
      }}>
        <option value="unrestricted">{t("revision.unrestricted")}</option>
        <option value="text_only">{t("revision.text_only")}</option>
        <option value="image_only">{t("revision.image_only")}</option>
      </select>
    </label>
    {scope.mode !== "unrestricted" && <details>
      <summary className="cursor-pointer py-1 text-xs">{t("revision.targets")}</summary>
      <p className="my-1 text-xs text-muted-foreground">{t("revision.targetHint")}</p>
      <textarea key={scope.mode} aria-label={t("revision.targets")} aria-invalid={!valid} rows={2} maxLength={48_000} defaultValue={targets} className="w-full rounded border border-border bg-background p-2 font-mono text-xs" onChange={event => {
        const rows = event.target.value.split("\n").filter(row => row.trim() !== "");
        onChange({ mode: scope.mode, ...(rows.length === 0 ? {} : { targets: rows.map(row => {
          const [relPath, artboardId, nodeId, ...extra] = row.split(",").map(value => value.trim());
          return { rel_path: extra.length > 0 ? row : relPath ?? "", ...(artboardId ? { artboard_id: artboardId } : {}), ...(nodeId ? { node_id: nodeId } : {}) };
        }) }) });
      }} />
      {!valid && <p role="alert" className="text-xs text-destructive">{t("revision.invalid")}</p>}
    </details>}
  </div>;
}
