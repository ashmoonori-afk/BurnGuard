/**
 * The bounded Korean project brief fieldset. Pure presentation: it owns
 * no state and never talks to the network, so NewProjectPanel stays the
 * only place that decides whether a project can be created.
 */
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AUDIENCE_MAX_LENGTH,
  CONTENT_SOURCE_CHOICES,
  DENSITY_CHOICES,
  OBJECTIVE_MAX_LENGTH,
  OUTPUT_SIZE_CHOICES,
  PROJECT_CONTROL_CLASS,
  PROJECT_LABEL_CLASS,
  VISUAL_MOOD_CHOICES,
  type BriefChoice,
  type BriefForm,
} from "@/lib/project-creation";

export type BriefFieldChange = <K extends keyof BriefForm>(
  key: K,
  value: BriefForm[K],
) => void;

export default function ProjectBriefFields({
  form,
  disabled,
  onChange,
  showOutputSize = true,
}: {
  form: BriefForm;
  disabled: boolean;
  onChange: BriefFieldChange;
  showOutputSize?: boolean;
}) {
  return (
    <div className="space-y-4 border-t border-border pt-5">
      <div className="text-xs font-semibold text-muted-foreground">
        03 · 누구를 위한 작업인가요?
      </div>

      <div className="space-y-1.5">
        <label htmlFor="brief-audience" className={PROJECT_LABEL_CLASS}>
          누가 보게 되나요?
        </label>
        <Input
          id="brief-audience"
          placeholder="예: 국내 투자 심사역"
          maxLength={AUDIENCE_MAX_LENGTH}
          value={form.audience}
          required
          disabled={disabled}
          onChange={(e) => onChange("audience", e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="brief-objective" className={PROJECT_LABEL_CLASS}>
          무엇을 얻고 싶나요?
        </label>
        <textarea
          id="brief-objective"
          rows={2}
          placeholder="예: 다음 분기 예산 승인 받기"
          maxLength={OBJECTIVE_MAX_LENGTH}
          value={form.objective}
          required
          disabled={disabled}
          onChange={(e) => onChange("objective", e.target.value)}
          className={`${PROJECT_CONTROL_CLASS} h-auto resize-none py-2 leading-relaxed`}
        />
      </div>

      <details className="rounded-xl border border-border bg-muted/30 p-4">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">상세 설정 <span className="ml-1 text-xs font-normal text-muted-foreground">자료 · 스타일 · 크기</span></summary>
        <div className="mt-4 space-y-4">
      <ChoiceField
        id="brief-content-source"
        label="자료는 어디서 오나요?"
        choices={CONTENT_SOURCE_CHOICES}
        value={form.contentSource}
        disabled={disabled}
        onSelect={(v) => onChange("contentSource", v)}
      />

      <div className="grid grid-cols-2 gap-3">
        <ChoiceField
          id="brief-visual-mood"
          label="분위기"
          choices={VISUAL_MOOD_CHOICES}
          value={form.visualMood}
          disabled={disabled}
          onSelect={(v) => onChange("visualMood", v)}
        />
        <ChoiceField
          id="brief-density"
          label="정보 밀도"
          choices={DENSITY_CHOICES}
          value={form.density}
          disabled={disabled}
          onSelect={(v) => onChange("density", v)}
        />
      </div>

      {showOutputSize && (
        <ChoiceField
          id="brief-output-size"
          label="출력 크기"
          choices={OUTPUT_SIZE_CHOICES}
          value={form.outputSize}
          disabled={disabled}
          onSelect={(v) => onChange("outputSize", v)}
        />
      )}
        </div>
      </details>
    </div>
  );
}

function ChoiceField<T extends string>({
  id,
  label,
  choices,
  value,
  disabled,
  onSelect,
}: {
  id: string;
  label: string;
  choices: readonly BriefChoice<T>[];
  value: T;
  disabled: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={PROJECT_LABEL_CLASS}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const picked = choices.find((c) => c.value === e.target.value);
          if (picked) onSelect(picked.value);
        }}
        className={PROJECT_CONTROL_CLASS}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ToggleRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <div>
        <div className="text-sm">{title}</div>
        <div className="text-xs text-foreground/80">{hint}</div>
      </div>
      <Switch
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
