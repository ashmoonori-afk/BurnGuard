import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  LOGO_GEOMETRIC_DIRECTIONS,
  LOGO_GEOMETRIC_NOTE_MAX,
  LOGO_GEOMETRIC_OTHER_MAX,
  LOGO_GEOMETRIC_PARTS,
  LOGO_GEOMETRY_FILE,
  logoGeometricSteps,
  type LogoGeometricActionV1,
  type LogoGeometricAnswersV1,
  type LogoGeometricDirection,
  type LogoGeometricFindingKind,
  type LogoGeometricParts,
  type LogoGeometricPlanItem,
  type LogoGeometricStatusV1,
  type LogoGeometricStep,
} from "@bg/shared";
import { getLogoGeometricStatus } from "@/api/logo-geometric";
import { listProjectFiles } from "@/api/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/utils";

type Geometric = Extract<LogoGeometricStatusV1, { method: "geometric" }>;

const PART_LABELS: Readonly<Record<LogoGeometricParts, MessageKey>> = {
  symbol_wordmark: "logo.geometric.parts.symbol_wordmark",
  symbol: "logo.geometric.parts.symbol",
  wordmark: "logo.geometric.parts.wordmark",
};
const DIRECTION_LABELS: Readonly<Record<LogoGeometricDirection, MessageKey>> = {
  sharp_geometric: "logo.geometric.direction.sharp_geometric",
  bold_abstract: "logo.geometric.direction.bold_abstract",
  auto: "logo.geometric.direction.auto",
};
const STEP_LABELS: Readonly<Record<LogoGeometricStep, MessageKey>> = {
  symbol: "logo.geometric.step.symbol",
  wordmark: "logo.geometric.step.wordmark",
  lockup: "logo.geometric.step.lockup",
};
const STATUS_LABELS: Readonly<Record<LogoGeometricPlanItem["status"], MessageKey>> = {
  done: "logo.geometric.status.done",
  awaiting_review: "logo.geometric.status.awaiting_review",
  next: "logo.geometric.status.next",
  pending: "logo.geometric.status.pending",
};
const FINDING_LABELS: Readonly<Record<LogoGeometricFindingKind, MessageKey>> = {
  sliver: "logo.geometric.finding.sliver",
  near_touch: "logo.geometric.finding.near_touch",
  duplicate_guide: "logo.geometric.finding.duplicate_guide",
  closed_counter: "logo.geometric.finding.closed_counter",
};

/**
 * The method's status, refetched when a turn rewrites any of its files. The key follows the shared
 * project file listing (as the construction card does), so nothing polls.
 */
export function useLogoGeometricStatus(projectId: string, enabled: boolean) {
  const files = useQuery({ queryKey: ["project", projectId, "files"], queryFn: () => listProjectFiles(projectId), enabled });
  const version = (files.data ?? [])
    .filter((file) => file.rel_path === LOGO_GEOMETRY_FILE || file.rel_path.startsWith("geometric/"))
    .map((file) => `${file.rel_path}:${file.hash ?? String(file.updated_at ?? 0)}`)
    .sort()
    .join("|");
  return useQuery<LogoGeometricStatusV1>({
    queryKey: ["projects", projectId, "logo-geometric", version],
    enabled: enabled && files.isSuccess,
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) => getLogoGeometricStatus(projectId, signal),
  });
}

/** Whether every step a parts answer asks for can be made by this build. */
function partsAvailable(parts: LogoGeometricAnswersV1["parts"], available: readonly LogoGeometricStep[]): boolean {
  return logoGeometricSteps({ schema_version: 1, parts, direction: { choice: "auto" } }).every((step) => available.includes(step));
}

/**
 * The geometric logo flow (doc/31): two questions, then a plan and one candidate at a time with
 * Approve or Ask for changes. The mark itself is the symbol card above; this panel holds the
 * decisions. Every choice is sent as a turn, so the panel keeps no state the server does not have.
 */
export default function LogoGeometricPanel({
  status,
  loadFailed,
  disabled,
  onAction,
  onMake,
  onRetry,
}: {
  readonly status: Geometric | null;
  readonly loadFailed: boolean;
  readonly disabled: boolean;
  readonly onAction: (action: LogoGeometricActionV1) => void;
  readonly onMake: () => void;
  readonly onRetry: () => void;
}) {
  const t = useT();
  return (
    <section aria-label={t("logo.geometric.title")} className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4">
      {loadFailed && status === null ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-foreground">
          <p>{t("logo.geometric.loadFailed")}</p>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onRetry}>{t("logo.geometric.retry")}</Button>
        </div>
      ) : status === null ? null : status.answers === null ? (
        <Questions available={status.available_steps} disabled={disabled} onSubmit={(answers) => onAction({ action: "answer", ...answers })} />
      ) : (
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:gap-8">
          <Plan plan={status.plan} />
          <div className="min-w-0 flex-1">
            <Current status={status} disabled={disabled} onAction={onAction} onMake={onMake} />
          </div>
        </div>
      )}
    </section>
  );
}

function Working() {
  const t = useT();
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
      {t("logo.geometric.working")}
    </p>
  );
}

function Questions({ available, disabled, onSubmit }: {
  readonly available: readonly LogoGeometricStep[];
  readonly disabled: boolean;
  readonly onSubmit: (answers: Omit<LogoGeometricAnswersV1, "schema_version">) => void;
}) {
  const t = useT();
  const id = useId();
  const offered = LOGO_GEOMETRIC_PARTS.filter((part) => partsAvailable({ choice: part }, available));
  // With a single option open there is nothing to decide, so it starts chosen.
  const [parts, setParts] = useState<LogoGeometricParts | null>(offered.length === 1 ? offered[0] ?? null : null);
  const [direction, setDirection] = useState<LogoGeometricDirection | "other" | null>(null);
  const [other, setOther] = useState("");
  const otherText = other.trim();
  const ready = parts !== null && direction !== null && (direction !== "other" || otherText.length > 0);
  const otherPartsOpen = partsAvailable({ other: "x" }, available);

  return (
    <form
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || disabled) return;
        onSubmit({ parts: { choice: parts }, direction: direction === "other" ? { other: otherText } : { choice: direction } });
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">{t("logo.geometric.title")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("logo.geometric.intro")}</p>
      </div>
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-2 text-sm font-medium text-foreground">{t("logo.geometric.partsLegend")}</legend>
        <div className="grid gap-2 lg:grid-cols-2">
          {LOGO_GEOMETRIC_PARTS.map((part) => (
            <Choice key={part} name={`${id}-parts`} label={t(PART_LABELS[part])} checked={parts === part} onSelect={() => setParts(part)}
              unavailable={offered.includes(part) ? null : t("logo.geometric.later")} />
          ))}
          <Choice name={`${id}-parts`} label={t("logo.geometric.other")} checked={false} onSelect={() => undefined}
            unavailable={otherPartsOpen ? null : t("logo.geometric.later")} />
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-2 text-sm font-medium text-foreground">{t("logo.geometric.directionLegend")}</legend>
        <div className="grid gap-2 lg:grid-cols-2">
          {LOGO_GEOMETRIC_DIRECTIONS.map((value) => (
            <Choice key={value} name={`${id}-direction`} label={t(DIRECTION_LABELS[value])} checked={direction === value} onSelect={() => setDirection(value)} unavailable={null} />
          ))}
          <Choice name={`${id}-direction`} label={t("logo.geometric.other")} checked={direction === "other"} onSelect={() => setDirection("other")} unavailable={null} />
        </div>
        {direction === "other" ? (
          <div className="flex max-w-md flex-col gap-1.5 pt-1">
            <label htmlFor={`${id}-other`} className="text-sm font-medium text-foreground">{t("logo.geometric.otherLabel")}</label>
            <Input id={`${id}-other`} value={other} maxLength={LOGO_GEOMETRIC_OTHER_MAX} autoFocus
              aria-describedby={`${id}-other-hint`} className="min-h-11" onChange={(event) => setOther(event.target.value)} />
            <p id={`${id}-other-hint`} className="text-xs text-muted-foreground">{t("logo.geometric.otherHint")}</p>
          </div>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={!ready || disabled}>{t("logo.geometric.start")}</Button>
        {disabled ? <Working /> : null}
      </div>
    </form>
  );
}

function Choice({ name, label, checked, unavailable, onSelect }: {
  readonly name: string;
  readonly label: string;
  readonly checked: boolean;
  /** Why this option cannot be chosen yet, or null when it can. */
  readonly unavailable: string | null;
  readonly onSelect: () => void;
}) {
  const hint = useId();
  return (
    <label className={cn(
      "flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
      checked ? "border-accent bg-accent/10 text-foreground" : "border-border text-foreground",
      unavailable === null ? "cursor-pointer hover:bg-muted/60" : "cursor-not-allowed text-muted-foreground",
    )}>
      <input type="radio" name={name} checked={checked} disabled={unavailable !== null} onChange={onSelect}
        aria-describedby={unavailable === null ? undefined : hint} className="h-4 w-4 shrink-0 accent-[hsl(var(--accent))]" />
      <span className="flex min-w-0 flex-col">
        <span className={cn(checked && "font-medium")}>{label}</span>
        {unavailable === null ? null : <span id={hint} className="text-xs">{unavailable}</span>}
      </span>
    </label>
  );
}

/** Pinned as a list at desktop widths of 1280 px and up; one bar that opens the list below that. */
function Plan({ plan }: { readonly plan: readonly LogoGeometricPlanItem[] }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = plan.find((item) => item.status !== "done");
  const summary = current === undefined
    ? t("logo.geometric.planDone")
    : t("logo.geometric.planSummary", { step: t(STEP_LABELS[current.step]), status: t(STATUS_LABELS[current.status]) });
  return (
    <nav aria-label={t("logo.geometric.plan")} className="min-w-0 xl:w-56 xl:shrink-0">
      <button type="button" aria-expanded={open} aria-controls={`${id}-steps`} onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border px-3 text-left text-sm font-medium text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden">
        <span className="min-w-0">{summary}</span>
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0", open && "rotate-180")} />
      </button>
      <h2 className="mb-2 hidden text-sm font-semibold text-foreground xl:block">{t("logo.geometric.plan")}</h2>
      <ol id={`${id}-steps`} className={cn("mt-2 flex-col gap-1 xl:mt-0 xl:flex", open ? "flex" : "hidden")}>
        {plan.map((item, index) => (
          <li key={item.step} aria-current={item === current ? "step" : undefined}
            className={cn("flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm", item === current ? "bg-muted/60 font-medium text-foreground" : "text-muted-foreground")}>
            <span aria-hidden="true" className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
              item.status === "done" ? "bg-accent/10 text-accent" : item === current ? "bg-accent text-accent-foreground" : "border border-border",
            )}>{index + 1}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-foreground">{t(STEP_LABELS[item.step])}</span>
              <span className="text-xs text-muted-foreground">{t(STATUS_LABELS[item.status])}</span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Current({ status, disabled, onAction, onMake }: {
  readonly status: Geometric;
  readonly disabled: boolean;
  readonly onAction: (action: LogoGeometricActionV1) => void;
  readonly onMake: () => void;
}) {
  const t = useT();
  const id = useId();
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState("");
  // Closing the note returns focus to the button that opened it, so the keyboard place is kept.
  const [returnFocus, setReturnFocus] = useState(false);
  const reviseButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (revising || !returnFocus) return;
    reviseButton.current?.focus();
    setReturnFocus(false);
  }, [revising, returnFocus]);
  const closeNote = () => { setRevising(false); setNote(""); setReturnFocus(true); };
  const current = status.plan.find((item) => item.status !== "done");
  if (current === undefined) return <p role="status" className="text-sm text-foreground">{t("logo.geometric.complete")}</p>;
  const record = status.records[current.step];
  if (current.status !== "awaiting_review" || record === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-foreground">{t("logo.geometric.notMade")}</p>
        {status.available_steps.includes(current.step) ? (
          <Button type="button" className="min-h-11" disabled={disabled} onClick={onMake}>{t("logo.geometric.make")}</Button>
        ) : null}
        {disabled ? <Working /> : null}
      </div>
    );
  }
  const review = current.step === "symbol" ? status.symbol_review : null;
  const text = note.trim();
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">{t("logo.geometric.checks")}</h2>
        {review === null ? (
          <p className="text-sm text-muted-foreground">{t("logo.geometric.checksMissing")}</p>
        ) : review.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logo.geometric.checksPassed")}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
            {review.findings.map((kind) => <li key={kind}>{t(FINDING_LABELS[kind])}</li>)}
          </ul>
        )}
      </div>
      {revising ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (text.length === 0 || disabled) return;
          onAction({ action: "revise", step: current.step, record_sha256: record, note: text });
          setRevising(false);
          setNote("");
        }}>
          <label htmlFor={`${id}-note`} className="text-sm font-medium text-foreground">{t("logo.geometric.noteLabel")}</label>
          <textarea id={`${id}-note`} value={note} maxLength={LOGO_GEOMETRIC_NOTE_MAX} rows={3} autoFocus disabled={disabled}
            aria-describedby={`${id}-count`} onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") closeNote(); }}
            className="w-full rounded-control border border-input bg-card px-3 py-2 text-sm leading-6 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted" />
          <p id={`${id}-count`} className="text-xs tabular-nums text-muted-foreground">{t("logo.geometric.noteCount", { count: note.length, max: LOGO_GEOMETRIC_NOTE_MAX })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="min-h-11" disabled={text.length === 0 || disabled}>{t("logo.geometric.sendNote")}</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={closeNote}>{t("logo.geometric.cancel")}</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="min-h-11" disabled={disabled} onClick={() => onAction({ action: "approve", step: current.step, record_sha256: record })}>{t("logo.geometric.approve")}</Button>
          <Button ref={reviseButton} type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={() => setRevising(true)}>{t("logo.geometric.revise")}</Button>
          {disabled ? <Working /> : null}
        </div>
      )}
    </div>
  );
}
