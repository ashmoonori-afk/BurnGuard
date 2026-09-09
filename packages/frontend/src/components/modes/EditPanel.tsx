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
  const [text, setText] = useState("");
  const [attrRows, setAttrRows] = useState<AttrRow[]>([]);

  useEffect(() => {
    if (!target) {
      setText("");
      setAttrRows([]);
      return;
    }
    setText(target.text);
    setAttrRows(
      Object.entries(target.attributes)
        .filter(([k]) => k !== "data-bg-node-id")
        .map(([key, value]) => ({ key, value })),
    );
  }, [target]);

  if (!target) {
    return (
      <div className="p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          편집
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          캔버스에 마우스를 올리면 편집할 수 있는 요소가 강조되고, 클릭하면
          내용을 보고 고칠 수 있어요.{" "}
          <code className="font-mono">data-bg-node-id</code>가 있는 요소만
          편집할 수 있어요.
        </p>
      </div>
    );
  }

  const handleSave = () => {
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
    if (text !== target.text) patch.text = text;
    if (Object.keys(attrDiff).length > 0) patch.attributes = attrDiff;

    if (patch.text === undefined && patch.attributes === undefined) {
      return; // nothing changed
    }
    onSave(patch);
  };

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            편집
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            선택 해제
          </button>
        </div>
        <div className="mt-1 font-mono text-xs">&lt;{target.tag}&gt;</div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          data-bg-node-id="{target.bg_id}"
        </div>
      </div>

      <section className="px-3 py-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          텍스트 내용
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="mt-1 w-full resize-none rounded border border-border bg-background p-1.5 text-xs font-mono"
        />
      </section>

      <section className="px-3 py-2 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            속성
          </span>
          <button
            type="button"
            onClick={() => setAttrRows((prev) => [...prev, { key: "", value: "" }])}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            + 추가
          </button>
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {attrRows.length === 0 && (
            <p className="text-[10px] text-muted-foreground">속성이 없어요.</p>
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
                placeholder="이름"
                className="min-w-0 flex-1 rounded border border-border bg-background p-1 text-[11px] font-mono"
              />
              <input
                value={row.value}
                onChange={(e) => {
                  const next = attrRows.slice();
                  next[idx] = { ...next[idx], value: e.target.value };
                  setAttrRows(next);
                }}
                placeholder="값"
                className="min-w-0 flex-1 rounded border border-border bg-background p-1 text-[11px] font-mono"
              />
              <button
                type="button"
                onClick={() => setAttrRows(attrRows.filter((_, i) => i !== idx))}
                className="px-1 text-muted-foreground hover:text-foreground"
                aria-label="속성 삭제"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-border px-3 py-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
          variant="cta"
          size="sm"
          className="w-full"
        >
          {saving ? "저장하는 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
}
