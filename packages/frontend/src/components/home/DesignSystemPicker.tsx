import { useState } from "react";
import type { DesignSystemSummary } from "@bg/shared";
import { Palette, RefreshCw } from "lucide-react";
import { useT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterHomeCards, systemToCard } from "./mappers";

export default function DesignSystemPicker({
  systems, selectedId, loading, error, allowNone, onSelect, onRefresh, onBack, onApply,
}: {
  systems: readonly DesignSystemSummary[];
  selectedId: string | null;
  loading: boolean;
  error: Error | null;
  allowNone: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onBack: () => void;
  onApply: (id: string | null) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const cards = filterHomeCards(systems.map(systemToCard), query);
  const selected = systems.find((system) => system.id === selectedId);

  return <section className="space-y-4 p-6" aria-labelledby="system-picker-title" aria-busy={loading}>
    <div>
      <h2 id="system-picker-title" className="text-lg font-semibold">{t("home.picker.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("home.picker.hint")}</p>
    </div>
    <div className="flex gap-2">
      <Input type="search" autoFocus aria-label={t("home.picker.search")} placeholder={t("home.picker.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
      <Button type="button" variant="outline" disabled={loading} onClick={() => { setFailedImages(new Set()); onRefresh(); }}>
        <RefreshCw className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />{t("home.picker.refresh")}
      </Button>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{t("home.creation.systemsError")}</p>
      : loading ? <p role="status" className="text-sm text-muted-foreground">{t("home.systemsLoading")}</p>
      : cards.length === 0 ? <p role="status" className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">{t(systems.length ? "home.picker.noMatches" : "home.picker.empty")}</p> : null}
    <fieldset disabled={loading || error !== null} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <legend className="sr-only">{t("home.picker.title")}</legend>
      {cards.map((card) => <label key={card.id} className={`relative min-w-0 cursor-pointer overflow-hidden rounded-xl border-2 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${selectedId === card.id ? "border-accent bg-accent-soft" : "border-border bg-card hover:border-accent/50"}`}>
        <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted">
          {card.thumbnail && !failedImages.has(card.thumbnail)
            ? <img src={card.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailedImages((current) => new Set([...current, card.thumbnail!]))} />
            : <div className="flex flex-col items-center gap-2 px-3 text-center text-xs text-muted-foreground"><Palette className="h-7 w-7" aria-hidden="true" />{t("home.picker.noPreview")}</div>}
        </div>
        <div className="flex items-center gap-3 p-3">
          <input type="radio" name="onboarding-design-system" aria-label={card.name} value={card.id} checked={selectedId === card.id} onChange={() => onSelect(card.id)} className="h-4 w-4 shrink-0 accent-accent" />
          <span className="min-w-0 break-words text-sm font-medium">{card.name}</span>
        </div>
      </label>)}
    </fieldset>
    <div className="sticky -bottom-6 space-y-3 border-t border-border bg-card pb-6 pt-4">
      <p role="status" className="text-sm text-muted-foreground">{selected ? t("home.picker.selected", { name: selected.name }) : t("home.picker.selectHint")}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack}>{t("home.picker.back")}</Button>
        <Button type="button" variant="cta" className="min-w-0 flex-1" disabled={!selected || loading || error !== null} onClick={() => { if (selected) onApply(selected.id); }}>{t("home.picker.apply")}</Button>
      </div>
      {allowNone && <button type="button" className="min-h-10 w-full rounded-lg text-sm text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onApply(null)}>{t("home.creation.noSystem")}</button>}
    </div>
  </section>;
}
