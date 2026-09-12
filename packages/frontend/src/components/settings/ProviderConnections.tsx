import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LLM_CONNECTIONS, type LlmConnectionId, type SettingsSummary } from "@bg/shared";
import { patchSettings } from "@/api/home";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/t";
import { apiErrorCopy } from "@/lib/error-copy";
import { useUIStore } from "@/state/uiStore";

export default function ProviderConnections({ connections, onSaved, onSavingChange }: {
  connections: SettingsSummary["llm_connections"];
  onSaved: (settings: SettingsSummary) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [keys, setKeys] = useState<Partial<Record<LlmConnectionId, string>>>({});
  const [saving, setSaving] = useState(false);

  async function save(id: LlmConnectionId, name: string, value: string | null) {
    setSaving(true);
    onSavingChange(true);
    try {
      const next = await patchSettings({ llm_api_keys: { [id]: value } });
      // Merge only connection status into the dialog's unsaved general settings.
      onSaved(next);
      queryClient.setQueryData(["settings"], next);
      queryClient.setQueryData(["settings", "dialog"], next);
      setKeys((draft) => ({ ...draft, [id]: "" }));
      pushToast({ title: t(value === null ? "settings.keyDeleted" : "settings.keySaved", { name }), tone: "success" });
    } catch (error) {
      pushToast({ title: t("settings.keyFailed", { name }), body: apiErrorCopy(error), tone: "error" });
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  return <fieldset disabled={saving} className="min-w-0 space-y-3">
    <legend className="text-sm font-medium">{t("settings.providerTitle")}</legend>
    <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.providerHint")}</p>
    <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.providerReadiness")}</p>
    {LLM_CONNECTIONS.map(({ id, display_name: name }) => {
      const configured = connections?.find((connection) => connection.id === id)?.api_key_set ?? false;
      const key = keys[id] ?? "";
      return <div key={id} className="space-y-2 rounded-xl border border-border p-3">
        <label htmlFor={`llm-key-${id}`} className="text-sm font-medium">{t("settings.providerKey", { name })}</label>
        <p role="status" className="text-xs text-muted-foreground">{t(configured ? "settings.keySet" : "settings.keyUnset")}</p>
        <Input id={`llm-key-${id}`} type="password" autoComplete="new-password" value={key} onChange={(event) => setKeys((draft) => ({ ...draft, [id]: event.target.value }))} placeholder={t("settings.keyInput")} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={saving || !key.trim()} onClick={() => void save(id, name, key.trim())}>{t("settings.keySave")}</Button>
          <Button type="button" size="sm" variant="outline" disabled={saving || !configured} onClick={() => void save(id, name, null)}>{t("settings.keyDelete")}</Button>
        </div>
      </div>;
    })}
  </fieldset>;
}
