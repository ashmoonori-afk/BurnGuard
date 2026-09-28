import { useState } from "react";
import type { DesignSystemAssetGuide, DesignSystemAssetKind } from "@bg/shared";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/i18n/t";

const kindLabels: Record<DesignSystemAssetKind, MessageKey> = {
  logo: "system.assets.kind.logo", icons: "system.assets.kind.icons", illustrations: "system.assets.kind.illustrations",
  photography: "system.assets.kind.photography", backgrounds: "system.assets.kind.backgrounds", patterns: "system.assets.kind.patterns",
  motion: "system.assets.kind.motion",
};

interface DesignSystemAssetsPanelProps {
  readonly assets?: DesignSystemAssetGuide;
  readonly loading?: boolean;
  readonly failed?: boolean;
}

export function DesignSystemAssetsPanel({ assets, loading = false, failed = false }: DesignSystemAssetsPanelProps) {
  const t = useT();
  const [copy, setCopy] = useState<{ readonly kind: DesignSystemAssetKind; readonly ok: boolean } | null>(null);
  const copyPrompt = (kind: DesignSystemAssetKind, text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopy({ kind, ok: true }), () => setCopy({ kind, ok: false }));
  };
  const rules = assets?.rules ?? [];
  return <section className="my-5 min-w-0 rounded-2xl border border-border bg-card p-5 text-left" aria-label={t("system.assets.title")}>
    <h2 className="text-lg font-semibold">{t("system.assets.title")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("system.assets.help")}</p>
    {loading || failed ? <p role={failed ? "alert" : "status"} className="mt-3 text-sm">{t(failed ? "system.loadFailed" : "system.assets.loading")}</p>
      : rules.length === 0 ? <p role="status" className="mt-3 text-sm text-muted-foreground">{t("system.assets.empty")}</p> : null}
    {rules.length ? <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">{rules.map(rule => {
      const promptText = rule.prompt ? (rule.negative ? `${rule.prompt}\n\nNegative: ${rule.negative}` : rule.prompt) : null;
      return <article key={rule.kind} className="min-w-0 rounded-xl bg-muted/40 p-3">
        <h3 className="text-sm font-semibold">{t(kindLabels[rule.kind])}</h3>
        {rule.usage ? <div className="mt-2"><h4 className="text-xs font-medium text-muted-foreground">{t("system.assets.usage")}</h4><p className="mt-1 whitespace-pre-line break-words text-sm leading-6">{rule.usage}</p></div> : null}
        {rule.prompt || rule.negative ? <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">{t("system.assets.prompt")}</summary>
          {rule.prompt ? <p className="mt-2 whitespace-pre-line break-words rounded-lg bg-background p-2 font-mono text-xs leading-5">{rule.prompt}</p> : null}
          {rule.negative ? <p className="mt-2 break-words text-xs leading-5 text-muted-foreground"><span className="font-medium">{t("system.assets.negative")}: </span>{rule.negative}</p> : null}
        </details> : null}
        {promptText ? <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => copyPrompt(rule.kind, promptText)}>{t("system.assets.copy")}</Button>
          {copy?.kind === rule.kind ? <span role="status" className="text-xs text-muted-foreground">{t(copy.ok ? "system.assets.copied" : "system.assets.copyFailed")}</span> : null}
        </div> : null}
      </article>;
    })}</div> : null}
  </section>;
}
