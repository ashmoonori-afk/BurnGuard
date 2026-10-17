import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MAX_DESIGN_SYSTEM_RULE_CHARS, type DesignSystemRule, type DesignSystemRuleKind, type DesignSystemRules } from "@bg/shared";
import { Trash2 } from "lucide-react";
import { addDesignSystemRule, deleteDesignSystemRule } from "@/api/design-system";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorCopy } from "@/lib/error-copy";
import { groupDesignSystemRules } from "@/lib/design-system-rules";
import { useUIStore } from "@/state/uiStore";
import { useT, type MessageKey } from "@/i18n/t";

interface DesignSystemRulesPanelProps {
  readonly systemId: string;
  readonly rules?: DesignSystemRules;
  readonly loading: boolean;
}

const originLabel: Record<DesignSystemRule["origin"]["type"], MessageKey> = {
  manual: "system.rules.origin.manual",
  imported: "system.rules.origin.imported",
  correction: "system.rules.origin.correction",
};

export function DesignSystemRulesPanel({ systemId, rules, loading }: DesignSystemRulesPanelProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const pushToast = useUIStore(state => state.pushToast);
  const [kind, setKind] = useState<DesignSystemRuleKind>("dont");
  const [text, setText] = useState("");
  const saved = (next: DesignSystemRules) => queryClient.setQueryData(["design-systems", "tokens", systemId], (current: object | undefined) => current ? { ...current, rules: next } : current);
  const onError = (err: unknown) => pushToast({ tone: "error", title: t("system.rules.failed"), body: apiErrorCopy(err) });
  const add = useMutation({ mutationFn: () => addDesignSystemRule(systemId, { kind, text }), onSuccess: next => { saved(next); setText(""); }, onError });
  const remove = useMutation({ mutationFn: (ruleId: string) => deleteDesignSystemRule(systemId, ruleId), onSuccess: saved, onError });
  const groups = groupDesignSystemRules(rules);
  const submit = (event: FormEvent) => { event.preventDefault(); if (text.trim()) add.mutate(); };
  const list = (title: MessageKey, items: readonly DesignSystemRule[], ruleKind: DesignSystemRuleKind) => <div className="min-w-0" data-rule-group={ruleKind}>
    <h3 className="text-sm font-semibold">{t(title)}</h3>
    {items.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t("system.rules.none")}</p> : <ul className="mt-2 space-y-2">
      {items.map(rule => <li key={rule.id} data-rule-id={rule.id} className="flex min-w-0 items-start justify-between gap-3 border-t border-border pt-2">
        <div className="min-w-0"><p className="break-words text-sm">{rule.text}</p><p className="mt-0.5 text-xs text-muted-foreground">{t(originLabel[rule.origin.type])}</p></div>
        <Button type="button" variant="ghost" size="sm" aria-label={t("system.rules.delete")} disabled={remove.isPending} onClick={() => remove.mutate(rule.id)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
      </li>)}
    </ul>}
  </div>;
  return <section className="my-5 min-w-0 rounded-2xl border border-border bg-card p-5 text-left" aria-label={t("system.rules.title")}>
    <h2 className="text-lg font-semibold">{t("system.rules.title")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("system.rules.help")}</p>
    {loading ? <p role="status" className="mt-4 text-sm text-muted-foreground">{t("system.rules.loading")}</p> : <div className="mt-4 grid min-w-0 gap-5 md:grid-cols-2">
      {list("system.rules.do", groups.do, "do")}
      {list("system.rules.dont", groups.dont, "dont")}
    </div>}
    <form className="mt-5 flex min-w-0 flex-wrap items-center gap-2" onSubmit={submit}>
      <select aria-label={t("system.rules.kind")} className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={kind} onChange={event => setKind(event.target.value === "do" ? "do" : "dont")}>
        <option value="do">{t("system.rules.do")}</option>
        <option value="dont">{t("system.rules.dont")}</option>
      </select>
      <Input className="min-w-48 flex-1" maxLength={MAX_DESIGN_SYSTEM_RULE_CHARS} value={text} placeholder={t("system.rules.placeholder")} aria-label={t("system.rules.placeholder")} onChange={event => setText(event.target.value)} />
      <Button type="submit" size="sm" disabled={add.isPending || !text.trim()}>{t("system.rules.add")}</Button>
    </form>
  </section>;
}
