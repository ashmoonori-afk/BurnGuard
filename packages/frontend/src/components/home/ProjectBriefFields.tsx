/**
 * The bounded Korean project brief fieldset. Pure presentation: it owns
 * no state and never talks to the network, so NewProjectPanel stays the
 * only place that decides whether a project can be created.
 */
import { useT } from "@/i18n/t";
import { Switch } from "@/components/ui/switch";
import type { DesignBriefContentSource, DesignBriefOutputSize } from "@bg/shared";
import {
  CONTENT_SOURCE_CHOICES,
  DENSITY_CHOICES,
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
  contentSourceChoices = CONTENT_SOURCE_CHOICES,
  outputSizeChoices = OUTPUT_SIZE_CHOICES,
  showOutputSize = true,
}: {
  form: BriefForm;
  disabled: boolean;
  onChange: BriefFieldChange;
  contentSourceChoices?: readonly BriefChoice<DesignBriefContentSource>[];
  outputSizeChoices?: readonly BriefChoice<DesignBriefOutputSize>[];
  showOutputSize?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      <ChoiceField
        id="brief-content-source"
        label={t("home.brief.source")}
        choices={contentSourceChoices}
        value={form.contentSource}
        disabled={disabled}
        onSelect={(v) => onChange("contentSource", v)}
      />

      <div className="grid grid-cols-2 gap-3">
        <ChoiceField
          id="brief-visual-mood"
          label={t("home.brief.mood")}
          choices={VISUAL_MOOD_CHOICES}
          value={form.visualMood}
          disabled={disabled}
          onSelect={(v) => onChange("visualMood", v)}
        />
        <ChoiceField
          id="brief-density"
          label={t("home.brief.density")}
          choices={DENSITY_CHOICES}
          value={form.density}
          disabled={disabled}
          onSelect={(v) => onChange("density", v)}
        />
      </div>

      {showOutputSize && (
        <ChoiceField
          id="brief-output-size"
          label={t("home.brief.size")}
          choices={outputSizeChoices}
          value={form.outputSize}
          disabled={disabled}
          onSelect={(v) => onChange("outputSize", v)}
        />
      )}
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
  const t = useT();
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
            {t(c.label)}
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
