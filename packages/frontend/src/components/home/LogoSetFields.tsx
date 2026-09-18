import { useState } from "react";
import { X } from "lucide-react";
import type { LogoType } from "@bg/shared";
import { useT, type MessageKey } from "@/i18n/t";
import { Input } from "@/components/ui/input";
import { LOGO_TYPE_CHOICES } from "@/lib/logo-project";
import {
  PROJECT_CONTROL_CLASS,
  PROJECT_LABEL_CLASS,
  type BriefForm,
} from "@/lib/project-creation";

const CHARACTER_LIMIT = 7;
const SYMBOL_LIMIT = 8;
const CHIP_MAX_LENGTH = 40;
const AVOID_MAX_LENGTH = 300;

/**
 * The logo brief of doc/23 D2. Every control writes into the same draft the
 * shared parser validates, so a brief the backend would refuse is refused by the
 * panel first; the fixed 1920×1080 page means there is no canvas to ask about.
 */
export function LogoSetFields({
  form,
  disabled,
  onChange,
}: {
  readonly form: BriefForm;
  readonly disabled: boolean;
  readonly onChange: (patch: Partial<BriefForm>) => void;
}) {
  const t = useT();

  return (
    <fieldset className="space-y-4 border-t border-border pt-4" disabled={disabled}>
      <legend className="text-xs font-medium text-foreground/80">{t("home.logo.brief")}</legend>

      <div className="space-y-1.5">
        <label htmlFor="logo-brand-name" className={PROJECT_LABEL_CLASS}>{t("home.logo.brandName")}</label>
        <Input
          id="logo-brand-name"
          value={form.logoBrandName}
          maxLength={80}
          placeholder={t("home.logo.brandNamePlaceholder")}
          onChange={(event) => onChange({ logoBrandName: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="logo-niche" className={PROJECT_LABEL_CLASS}>{t("home.logo.niche")}</label>
        <Input
          id="logo-niche"
          value={form.logoNiche}
          maxLength={200}
          placeholder={t("home.logo.nichePlaceholder")}
          onChange={(event) => onChange({ logoNiche: event.target.value })}
        />
      </div>

      <ChipField
        id="logo-character"
        label="home.logo.character"
        hint="home.logo.characterHint"
        placeholder="home.logo.characterPlaceholder"
        values={form.logoCharacter}
        limit={CHARACTER_LIMIT}
        onChange={(values) => onChange({ logoCharacter: values })}
      />

      <div className="space-y-1.5">
        <label htmlFor="logo-type" className={PROJECT_LABEL_CLASS}>{t("home.logo.type")}</label>
        <select
          id="logo-type"
          className={PROJECT_CONTROL_CLASS}
          value={form.logoType}
          onChange={(event) => onChange({ logoType: event.target.value as LogoType })}
        >
          {LOGO_TYPE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>{t(choice.label)}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t("home.logo.typeHint")}</p>
      </div>

      <ChipField
        id="logo-symbols"
        label="home.logo.symbols"
        hint="home.logo.symbolsHint"
        placeholder="home.logo.symbolsPlaceholder"
        values={form.logoSymbolKeywords}
        limit={SYMBOL_LIMIT}
        onChange={(values) => onChange({ logoSymbolKeywords: values })}
      />

      <div className="space-y-1.5">
        <label htmlFor="logo-avoid" className={PROJECT_LABEL_CLASS}>{t("home.logo.avoid")}</label>
        <textarea
          id="logo-avoid"
          rows={2}
          maxLength={AVOID_MAX_LENGTH}
          value={form.logoAvoid}
          aria-describedby="logo-avoid-hint"
          placeholder={t("home.logo.avoidPlaceholder")}
          onChange={(event) => onChange({ logoAvoid: event.target.value })}
          className="w-full rounded-md border border-input bg-background p-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p id="logo-avoid-hint" className="text-pretty break-keep text-xs text-muted-foreground">
          {t("home.logo.avoidHint")} ({form.logoAvoid.length}/{AVOID_MAX_LENGTH})
        </p>
      </div>
    </fieldset>
  );
}

/**
 * Short words, not sentences: Enter or a comma commits one chip, and the entry
 * field disappears at the limit so the draft can never exceed what the contract
 * accepts. Every chip keeps its own remove button for keyboard users.
 */
function ChipField({
  id,
  label,
  hint,
  placeholder,
  values,
  limit,
  onChange,
}: {
  readonly id: string;
  readonly label: MessageKey;
  readonly hint: MessageKey;
  readonly placeholder: MessageKey;
  readonly values: readonly string[];
  readonly limit: number;
  readonly onChange: (values: readonly string[]) => void;
}) {
  const t = useT();
  const [pending, setPending] = useState("");

  function commit(raw: string): void {
    const added = raw
      .split(",")
      .map((value) => value.trim().slice(0, CHIP_MAX_LENGTH))
      .filter((value) => value !== "" && !values.includes(value));
    if (added.length === 0) return;
    onChange([...values, ...added].slice(0, limit));
  }

  return (
    <div className="space-y-1.5">
      <label id={`${id}-label`} htmlFor={id} className={PROJECT_LABEL_CLASS}>{t(label)}</label>
      {values.length > 0 && (
        <ul aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
          {values.map((value) => (
            <li key={value}>
              <button
                type="button"
                aria-label={t("home.logo.chipRemove", { name: value })}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
                className="flex min-h-9 items-center gap-1 rounded-full border border-border bg-muted px-3 text-xs font-medium text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="max-w-40 truncate">{value}</span>
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {values.length < limit && (
        <Input
          id={id}
          value={pending}
          maxLength={CHIP_MAX_LENGTH}
          placeholder={t(placeholder)}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const next = event.target.value;
            if (!next.includes(",")) {
              setPending(next);
              return;
            }
            commit(next);
            setPending("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // The panel is a form: Enter here adds a word, it never submits.
            event.preventDefault();
            commit(pending);
            setPending("");
          }}
          onBlur={() => {
            commit(pending);
            setPending("");
          }}
        />
      )}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t(hint)} ({values.length}/{limit})
      </p>
    </div>
  );
}
