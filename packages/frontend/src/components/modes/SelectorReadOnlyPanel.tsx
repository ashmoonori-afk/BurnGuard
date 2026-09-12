import { useT } from "@/i18n/t";
import type { SelectedNode } from "@/types/project";
import {
  TWEAKS_STYLE_KEYS,
  type TweaksStyleKey,
  type TweaksTarget,
} from "@/components/canvas/TweaksLayer";

export default function SelectorReadOnlyPanel({
  selection,
  onPromoteToTweaks,
}: {
  selection: SelectedNode | null;
  onPromoteToTweaks: () => void;
}) {
  const t = useT();
  if (!selection) {
    return (
      <div className="p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          {t("modes.selector.title")}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("modes.selector.description")}
        </p>
        <p className="mt-3 text-[10px] text-muted-foreground leading-relaxed">
          {t("modes.selector.promoteHint")}
        </p>
      </div>
    );
  }

  const groups: Array<{ title: string; keys: string[] }> = [
    {
      title: t("modes.selector.typography"),
      keys: [
        "font-family",
        "font-size",
        "font-weight",
        "color",
        "line-height",
        "letter-spacing",
      ],
    },
    { title: t("modes.size"), keys: ["width", "height"] },
    {
      title: t("modes.selector.box"),
      keys: ["padding", "margin", "border", "border-radius", "background"],
    },
  ];

  return (
    <div className="p-3 overflow-y-auto">
      <div className="px-1 pb-2 border-b border-border mb-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("modes.selector.selector")}
        </div>
        <div className="text-xs font-mono mt-0.5 truncate">
          {selection.nodeId}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 truncate font-mono">
          {selection.file}
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.title} className="mb-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground px-1 mb-1">
            {g.title}
          </div>
          <div className="rounded-md border border-border bg-muted/40 overflow-hidden">
            {g.keys.map((k, i) => (
              <Row
                key={k}
                k={k}
                v={selection.computed[k] ?? "—"}
                last={i === g.keys.length - 1}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="text-[10px] text-muted-foreground px-1 mt-3 leading-relaxed">
        {t("modes.selector.computedHint")}
      </p>
      {selection.bgId && (
        <button
          type="button"
          onClick={onPromoteToTweaks}
          className="mx-1 mt-3 w-[calc(100%-0.5rem)] rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("modes.selector.openStyle")}
        </button>
      )}
    </div>
  );
}

export function selectedNodeToTweaksTarget(
  selection: SelectedNode | null,
): TweaksTarget | null {
  if (!selection?.bgId) return null;

  const computed: Partial<Record<TweaksStyleKey, string>> = {};
  const inline: Partial<Record<TweaksStyleKey, string>> = {};
  for (const key of TWEAKS_STYLE_KEYS) {
    if (selection.computed[key] !== undefined) {
      computed[key] = selection.computed[key];
    }
    if (selection.inline[key] !== undefined) {
      inline[key] = selection.inline[key];
    }
  }

  return {
    bg_id: selection.bgId,
    tag: selection.tag ?? "div",
    computed,
    inline,
  };
}

function Row({ k, v, last }: { k: string; v: string; last: boolean }) {
  return (
    <div
      className={
        "flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] " +
        (last ? "" : "border-b border-border")
      }
    >
      <span className="text-muted-foreground font-mono">{k}</span>
      <span
        className="font-mono truncate max-w-[170px] text-right"
        title={v}
      >
        {v}
      </span>
    </div>
  );
}
