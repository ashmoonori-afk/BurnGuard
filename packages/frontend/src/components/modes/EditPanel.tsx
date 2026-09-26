import { useT, type MessageKey } from "@/i18n/t";
import { useEffect, useState } from "react";
import type { EditTarget } from "@/components/canvas/EditLayer";
import { Button } from "@/components/ui/button";

interface AttrRow {
  key: string;
  value: string;
}

interface EditPatch {
  text?: string;
  attributes?: Record<string, string | null>;
}

/** The fields the element kind promises up front; everything else stays under Advanced attributes. */
const PRIMARY_FIELDS: Readonly<Record<string, ReadonlyArray<{ attr: string; label: MessageKey }>>> = {
  img: [{ attr: "src", label: "modes.edit.imageSrc" }, { attr: "alt", label: "modes.edit.imageAlt" }],
  a: [{ attr: "href", label: "modes.edit.linkHref" }],
};

function attrRowsFrom(target: EditTarget | null): AttrRow[] {
  return target === null ? [] : Object.entries(target.attributes)
    .filter(([k]) => k !== "data-bg-node-id")
    .map(([key, value]) => ({ key, value }));
}

/** Null means nothing changed; otherwise only the differing text and attributes are sent. */
export function buildEditPatch(target: EditTarget, text: string, attrRows: readonly AttrRow[]): EditPatch | null {
  const originalAttrs: Record<string, string> = { ...target.attributes };
  delete originalAttrs["data-bg-node-id"];

  const attrDiff: Record<string, string | null> = {};
  const currentKeys = new Set<string>();
  for (const row of attrRows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key === "data-bg-node-id") continue;
    currentKeys.add(key);
    if (originalAttrs[key] !== row.value) {
      attrDiff[key] = row.value;
    }
  }
  for (const origKey of Object.keys(originalAttrs)) {
    if (!currentKeys.has(origKey)) {
      attrDiff[origKey] = null;
    }
  }

  const patch: EditPatch = {};
  if (target.tag !== "img" && !target.hasBlockChildren && text !== target.text) patch.text = text;
  if (Object.keys(attrDiff).length > 0) patch.attributes = attrDiff;
  return patch.text === undefined && patch.attributes === undefined ? null : patch;
}

export default function EditPanel({
  target,
  saving,
  onSave,
  onClear,
}: {
  target: EditTarget | null;
  saving: boolean;
  onSave: (patch: EditPatch) => void;
  onClear: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(target?.text ?? "");
  const [attrRows, setAttrRows] = useState<AttrRow[]>(() => attrRowsFrom(target));

  useEffect(() => {
    setText(target?.text ?? "");
    setAttrRows(attrRowsFrom(target));
  }, [target]);

  if (!target) {
    return (
      <div className="p-4">
        <div className="mb-2 text-sm font-semibold">
          {t("modes.edit.title")}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("modes.edit.description")}
        </p>
      </div>
    );
  }

  const patch = buildEditPatch(target, text, attrRows);
  const primaryFields = PRIMARY_FIELDS[target.tag] ?? [];
  const setAttr = (key: string, value: string) => setAttrRows((prev) =>
    prev.some((row) => row.key === key) ? prev.map((row) => row.key === key ? { ...row, value } : row) : [...prev, { key, value }],
  );

  const handleSave = () => {
    if (patch === null) return; // nothing changed
    onSave(patch);
  };

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            {t("modes.edit.title")}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="min-h-9 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("modes.clearSelection")}
          </button>
        </div>
        <div className="mt-1 truncate text-xs font-medium">
          {target.tag === "img" ? t("modes.edit.image") : target.tag === "a" ? t("modes.edit.link") : t("modes.edit.textElement")}
          {target.text.trim() ? ` · ${target.text.trim()}` : ""}
        </div>
      </div>

      {primaryFields.length > 0 && (
        <section className="flex flex-col gap-3 px-4 py-3">
          {primaryFields.map((field) => (
            <label key={field.attr} className="block text-xs font-medium text-muted-foreground">
              {t(field.label)}
              <input
                value={attrRows.find((row) => row.key === field.attr)?.value ?? ""}
                onChange={(e) => setAttr(field.attr, e.target.value)}
                aria-label={t(field.label)}
                className="mt-2 min-h-10 w-full rounded-lg border border-border bg-background p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          ))}
        </section>
      )}

      {target.tag !== "img" && (
        <section className="px-4 py-3">
          <label htmlFor="element-edit-text" className="text-xs font-medium text-muted-foreground">
            {t("modes.edit.textContent")}
          </label>
          <textarea
            id="element-edit-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            disabled={target.hasBlockChildren}
            className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
          {target.hasBlockChildren && (
            <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">{t("modes.edit.selectLeaf")}</p>
          )}
        </section>
      )}

      <details className="border-t border-border px-4 py-3">
        <summary className="cursor-pointer text-xs leading-6">{t("modes.edit.advancedAttributes")}</summary>
        <div className="my-2 break-all font-mono text-[10px] text-muted-foreground">
          &lt;{target.tag}&gt; · {target.bg_id}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("modes.edit.attributes")}
          </span>
          <button
            type="button"
            onClick={() => setAttrRows((prev) => [...prev, { key: "", value: "" }])}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            {t("modes.edit.addAttribute")}
          </button>
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {attrRows.length === 0 && (
            <p className="text-[10px] text-muted-foreground">{t("modes.edit.noAttributes")}</p>
          )}
          {attrRows.map((row, idx) => (
            <div key={idx} className="flex gap-1">
              <input
                value={row.key}
                onChange={(e) => {
                  const next = attrRows.slice();
                  next[idx] = { ...next[idx], key: e.target.value };
                  setAttrRows(next);
                }}
                placeholder={t("modes.edit.name")}
                aria-label={t("modes.edit.attributeName", { number: idx + 1 })}
                className="min-h-10 min-w-0 flex-1 rounded border border-border bg-background p-2 text-xs font-mono"
              />
              <input
                value={row.value}
                onChange={(e) => {
                  const next = attrRows.slice();
                  next[idx] = { ...next[idx], value: e.target.value };
                  setAttrRows(next);
                }}
                placeholder={t("modes.edit.value")}
                aria-label={t("modes.edit.attributeValue", { number: idx + 1 })}
                className="min-h-10 min-w-0 flex-1 rounded border border-border bg-background p-2 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => setAttrRows(attrRows.filter((_, i) => i !== idx))}
                className="min-h-10 min-w-9 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("modes.edit.deleteAttribute")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </details>

      <div className="sticky bottom-0 border-t border-border bg-background px-4 py-3">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving || patch === null}
          variant="cta"
          className="min-h-11 w-full rounded-lg px-3 py-2 text-sm"
        >
          {saving ? t("modes.saving") : t("modes.save")}
        </Button>
      </div>
    </div>
  );
}
