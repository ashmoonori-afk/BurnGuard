import { useQuery } from "@tanstack/react-query";
import { COMMANDCODE_MODELS, type BackendId, type GenerationOptions } from "@bg/shared";
import { detectBackends, getSettings } from "@/api/home";
import { useT } from "@/i18n/t";

export default function GenerationControls({ backendId, value, onChange, disabled = false, compact = false }: {
  backendId: BackendId; value: GenerationOptions; onChange: (value: GenerationOptions) => void; disabled?: boolean; compact?: boolean;
}) {
  const t = useT();
  const detection = useQuery({ queryKey: ["backends", "detect"], queryFn: detectBackends });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const models = value.provider === "commandcode" ? COMMANDCODE_MODELS : detection.data?.backends.find((backend) => backend.id === backendId)?.models ?? [];
  const model = models.find((candidate) => candidate.id === value.model) ?? models[0];
  const efforts = model?.efforts ?? ["low"];
  const selectClass = "mt-1 min-h-9 w-full rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const secondary = <>
    {backendId === "claude-code" && <label className="block">{t("settings.connection")}
      <select aria-label={t("settings.modelConnection")} className={selectClass} value={value.provider} onChange={(event) => onChange({ ...value, provider: event.target.value as GenerationOptions["provider"], model: "", effort: "low" })}>
        <option value="native">{t("settings.claudeLogin")}</option>
        <option value="commandcode" disabled={!settings.data?.commandcode_api_key_set}>{t(settings.data?.commandcode_api_key_set ? "settings.commandcodeModel" : "settings.commandcodeModelNeedsKey")}</option>
      </select>
    </label>}
    <label className="flex items-center gap-2"><input type="checkbox" checked={value.vanilla} onChange={(event) => onChange({ ...value, vanilla: event.target.checked })} />{t("settings.vanilla")}</label>
  </>;
  return <fieldset disabled={disabled} className="space-y-2 text-xs disabled:opacity-60">
    <legend className="sr-only">{t("settings.generationOptions")}</legend>
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(90px,auto)] gap-2">
      <label>{t("settings.model")}<select aria-label={t("settings.generationModel")} className={selectClass} value={value.model} onChange={(event) => onChange({ ...value, model: event.target.value, effort: "low" })}>
        <option value="">{model ? t("settings.defaultModel", { name: models[0]?.label ?? "" }) : t("settings.toolDefault")}</option>
        {models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
      </select></label>
      <label>{t("settings.effort")}<select aria-label={t("settings.effort")} className={selectClass} value={value.effort} onChange={(event) => onChange({ ...value, effort: event.target.value as GenerationOptions["effort"] })}>
        {efforts.map((effort) => <option key={effort} value={effort}>{effort.toUpperCase()}</option>)}
      </select></label>
    </div>
    {compact ? <details className="text-muted-foreground">
      <summary className="cursor-pointer rounded py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("settings.additional")}</summary>
      <div className="mt-1 space-y-3 rounded-lg bg-muted/40 p-2.5">{secondary}</div>
    </details> : secondary}
  </fieldset>;
}
