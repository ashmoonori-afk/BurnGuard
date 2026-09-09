import { useQuery } from "@tanstack/react-query";
import { COMMANDCODE_MODELS, type BackendId, type GenerationOptions } from "@bg/shared";
import { detectBackends, getSettings } from "@/api/home";

export default function GenerationControls({ backendId, value, onChange, disabled = false }: {
  backendId: BackendId; value: GenerationOptions; onChange: (value: GenerationOptions) => void; disabled?: boolean;
}) {
  const detection = useQuery({ queryKey: ["backends", "detect"], queryFn: detectBackends });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const models = value.provider === "commandcode" ? COMMANDCODE_MODELS : detection.data?.backends.find((backend) => backend.id === backendId)?.models ?? [];
  const model = models.find((candidate) => candidate.id === value.model) ?? models[0];
  const efforts = model?.efforts ?? ["low"];
  const selectClass = "mt-1 min-h-9 w-full rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return <fieldset disabled={disabled} className="space-y-2 text-xs disabled:opacity-60">
    <legend className="sr-only">생성 모델과 추론 설정</legend>
    {backendId === "claude-code" && <label className="block">연결
      <select aria-label="모델 연결" className={selectClass} value={value.provider} onChange={(event) => onChange({ ...value, provider: event.target.value as GenerationOptions["provider"], model: "", effort: "low" })}>
        <option value="native">Claude Code 로그인</option>
        <option value="commandcode" disabled={!settings.data?.commandcode_api_key_set}>CommandCode · Claude 모델{settings.data?.commandcode_api_key_set ? "" : " (설정에서 API 키 저장)"}</option>
      </select>
    </label>}
    <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
      <label>모델<select aria-label="생성 모델" className={selectClass} value={value.model} onChange={(event) => onChange({ ...value, model: event.target.value, effort: "low" })}>
        <option value="">{model ? `기본 · ${models[0]?.label}` : "도구 기본 모델"}</option>
        {models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
      </select></label>
      <label>추론 강도<select aria-label="추론 강도" className={selectClass} value={value.effort} onChange={(event) => onChange({ ...value, effort: event.target.value as GenerationOptions["effort"] })}>
        {efforts.map((effort) => <option key={effort} value={effort}>{effort.toUpperCase()}</option>)}
      </select></label>
    </div>
    <label className="flex items-center gap-2"><input type="checkbox" checked={value.vanilla} onChange={(event) => onChange({ ...value, vanilla: event.target.checked })} />바닐라 모드 · 개인 플러그인과 지침 제외</label>
  </fieldset>;
}
