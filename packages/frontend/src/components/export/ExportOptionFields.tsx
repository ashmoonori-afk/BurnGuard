import { useT } from "@/i18n/t";
import type {
  ExportMenuOption,
  ExportOptionField,
  ExportOptionValues,
} from "./export-options";

const CONTROL_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

function uniqueFields(
  options: readonly ExportMenuOption[],
): readonly ExportOptionField[] {
  const seen = new Map<string, ExportOptionField>();
  for (const option of options) {
    if (option.disabledReason !== undefined) continue;
    for (const field of option.fields ?? []) if (!seen.has(field.kind)) seen.set(field.kind, field);
  }
  return [...seen.values()];
}

/**
 * Option inputs shared by every entry that accepts them. They sit above the
 * format list so a keystroke never reaches the menu's typeahead and so an
 * export failure leaves the entered values untouched.
 */
export default function ExportOptionFields({
  options,
  values,
  disabled,
  onChange,
}: {
  readonly options: readonly ExportMenuOption[];
  readonly values: ExportOptionValues;
  readonly disabled: boolean;
  readonly onChange: (values: ExportOptionValues) => void;
}) {
  const t = useT();
  const fields = uniqueFields(options);
  if (fields.length === 0) return null;
  return (
    <div
      className="mx-2 mb-2 space-y-3 rounded-md border border-border bg-muted/40 p-2"
      onKeyDown={(event) => event.stopPropagation()}
    >
      {fields.map((field) =>
        field.kind === "asset_base_url" ? (
          <div key={field.kind} className="space-y-1">
            <label htmlFor="export-asset-base-url" className="text-[11px] font-medium text-foreground/80">
              {field.label}
            </label>
            <input
              id="export-asset-base-url"
              type="text"
              className={CONTROL_CLASS}
              value={values.assetBaseUrl}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(event) => onChange({ ...values, assetBaseUrl: event.target.value })}
            />
            <p className="text-pretty break-keep text-[10px] text-muted-foreground">{field.hint}</p>
          </div>
        ) : (
          <div key={field.kind} className="space-y-1">
            <span className="text-[11px] font-medium text-foreground/80">{field.label}</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label htmlFor="export-slice-height" className="text-[10px] text-muted-foreground">{t("export.field.maxHeight")}</label>
                <select
                  id="export-slice-height"
                  className={CONTROL_CLASS}
                  value={values.sliceHeight}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...values, sliceHeight: event.target.value === "3000" ? 3000 : 5000 })}
                >
                  <option value="5000">{t("export.field.smartStore")}</option>
                  <option value="3000">{t("export.field.coupang")}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="export-slice-format" className="text-[10px] text-muted-foreground">{t("export.field.imageFormat")}</label>
                <select
                  id="export-slice-format"
                  className={CONTROL_CLASS}
                  value={values.sliceFormat}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...values, sliceFormat: event.target.value === "jpeg" ? "jpeg" : "png" })}
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </div>
            </div>
            {values.sliceFormat === "jpeg" && (
              <div className="space-y-1">
                <label htmlFor="export-jpeg-quality" className="text-[10px] text-muted-foreground">
                  {t("export.field.jpegQuality", { count: values.jpegQuality })}
                </label>
                <input
                  id="export-jpeg-quality"
                  type="range"
                  min={60}
                  max={95}
                  step={1}
                  className="w-full"
                  value={values.jpegQuality}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...values, jpegQuality: event.target.valueAsNumber })}
                />
              </div>
            )}
            <p className="text-pretty break-keep text-[10px] text-muted-foreground">{field.hint}</p>
          </div>
        ),
      )}
    </div>
  );
}
