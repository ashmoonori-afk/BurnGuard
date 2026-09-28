import { useState, type FormEvent } from "react";
import type {
  CreateVisualAlternativesRequest,
  VisualAlternativeList,
} from "@bg/shared";
import { Columns2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  busyDialogProps,
} from "@/components/ui/dialog";
import {
  readyCompareAlternatives,
  type CompareViewport,
} from "@/lib/visual-alternative-compare";
import { useT } from "@/i18n/t";
import AlternativeCard from "./AlternativeCard";
import RetainedAlternatives from "./RetainedAlternatives";

const NAME_FIELDS = ["alternative-a", "alternative-b", "alternative-c", "alternative-d"] as const;

type Props = {
  readonly state: VisualAlternativeList | null | undefined;
  readonly disabled: boolean;
  readonly generating: boolean;
  /** This tab's request is in flight; durable generation alone never traps the dialog. */
  readonly submitting: boolean;
  readonly cancelling: boolean;
  readonly promotingId: string | null;
  readonly deletingId: string | null;
  readonly onGenerate: (request: CreateVisualAlternativesRequest) => Promise<void>;
  readonly onPromote: (alternativeId: string) => Promise<void>;
  readonly onDelete: (alternativeId: string) => Promise<void>;
  readonly onCancel: () => Promise<void>;
};

export default function AlternativeCompare({
  state,
  disabled,
  generating,
  submitting,
  cancelling,
  promotingId,
  deletingId,
  onGenerate,
  onPromote,
  onDelete,
  onCancel,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<2 | 3 | 4>(2);
  const [prompt, setPrompt] = useState("");
  const [names, setNames] = useState(["A", "B", "C", "D"]);
  const [viewport, setViewport] = useState<CompareViewport>("desktop");
  const ready = readyCompareAlternatives(
    state?.alternatives ?? [],
    state?.generation_id,
  );
  const retained = readyCompareAlternatives(state?.alternatives ?? []).filter(
    (alternative) => alternative.generation_id !== state?.generation_id,
  );
  const busy = generating || promotingId !== null || deletingId !== null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onGenerate({ count, prompt, names: names.slice(0, count) });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("workspace.alternatives.title")}
        </button>
      </DialogTrigger>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-7xl gap-5"
        {...busyDialogProps(submitting || promotingId !== null || deletingId !== null)}
      >
        <DialogHeader>
          <DialogTitle>{t("workspace.alternatives.title")}</DialogTitle>
          <DialogDescription>{t("workspace.alternatives.description")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 rounded-xl bg-muted/60 p-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-3 md:grid-cols-[8rem_1fr]">
            <label className="grid gap-1 text-xs font-medium">
              {t("workspace.alternatives.count")}
              <select
                value={count}
                disabled={busy || disabled}
                className="h-10 rounded-md border border-input bg-background px-3"
                onChange={(event) => setCount(Number(event.target.value) === 4 ? 4 : Number(event.target.value) === 3 ? 3 : 2)}
              >
                {[2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium">
              {t("workspace.alternatives.request")}
              <textarea
                value={prompt}
                required
                maxLength={20_000}
                disabled={busy || disabled}
                className="min-h-20 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder={t("workspace.alternatives.requestPlaceholder")}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {names.slice(0, count).map((name, index) => (
              <label key={NAME_FIELDS[index]} className="grid gap-1 text-xs font-medium">
                {t("workspace.alternatives.name", { number: index + 1 })}
                <input
                  value={name}
                  required
                  maxLength={80}
                  disabled={busy || disabled}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) => setNames((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
          {generating && (
            <button
              type="button"
              disabled={cancelling}
              className="min-h-11 rounded-md border border-input px-4 text-sm font-medium disabled:opacity-50"
              onClick={() => void onCancel()}
            >
              {cancelling ? t("workspace.alternatives.cancelling") : t("workspace.alternatives.cancel")}
            </button>
          )}
          <button
            type="submit"
            disabled={busy || disabled || prompt.trim().length === 0 || new Set(names.slice(0, count).map((name) => name.trim())).size !== count}
            className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {generating ? t("workspace.alternatives.generating") : t("workspace.alternatives.generate")}
          </button>
          </div>
        </form>
        {state && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              {t(`workspace.alternatives.status.${state.status}`)}
            </p>
            <label className="flex items-center gap-2 text-xs font-medium">
              {t("workspace.alternatives.viewport")}
              <select
                value={viewport}
                className="h-9 rounded-md border border-input bg-background px-3"
                onChange={(event) => setViewport(event.target.value === "mobile" ? "mobile" : "desktop")}
              >
                <option value="desktop">{t("workspace.alternatives.desktop")}</option>
                <option value="mobile">{t("workspace.alternatives.mobile")}</option>
              </select>
            </label>
          </div>
        )}
        {state && ready.length === 0 && (
          <p className="rounded-xl bg-muted p-5 text-sm text-muted-foreground">
            {t("workspace.alternatives.empty")}
          </p>
        )}
        {ready.length > 0 && (
          <div className="grid max-h-[58vh] auto-rows-max content-start items-start gap-4 overflow-y-auto pr-1 xl:grid-cols-2">
            {ready.map((alternative) => (
              <AlternativeCard
                key={alternative.id}
                alternative={alternative}
                viewport={viewport}
                promoting={promotingId === alternative.id}
                deleting={deletingId === alternative.id}
                disabled={busy || disabled}
                onPromote={onPromote}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
        {retained.length > 0 && (
          <RetainedAlternatives
            alternatives={retained}
            disabled={busy || disabled}
            promotingId={promotingId}
            deletingId={deletingId}
            onPromote={onPromote}
            onDelete={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
