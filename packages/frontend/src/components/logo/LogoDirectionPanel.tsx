import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, Lightbulb, Loader2, RefreshCw, Shuffle } from "lucide-react";
import {
  LOGO_DIRECTION_IDS,
  LOGO_DIRECTION_PARTS,
  UpgradeContractError,
  parseLogoDirectionsV1,
  type LogoActionV1,
  type LogoAdoptPick,
  type LogoDirectionId,
  type LogoDirectionPart,
  type LogoDirectionV1,
  type LogoDirectionsV1,
} from "@bg/shared";
import { ApiError } from "@/api/client";
import { projectFileUrl, readProjectFileText } from "@/api/files";
import { Button } from "@/components/ui/button";
import { apiErrorCopy } from "@/lib/error-copy";
import { useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/utils";

const LOGO_DIRECTIONS_FILE = "ideas/directions.json";

const PART_LABELS: Record<LogoDirectionPart, MessageKey> = {
  name: "logo.pipeline.name",
  color: "logo.pipeline.color",
  shape: "logo.pipeline.shape",
  mood: "logo.pipeline.mood",
};

/** Presentation plates: a neutral positive ground and the canvas-ink negative ground. */
const LIGHT_PLATE = "#FFFFFF";
const DARK_PLATE = "#111111";
const INK = "#17191A";
const VISIBLE_MOODS = 3;

type DirectionRead =
  | { readonly kind: "ready"; readonly directions: LogoDirectionsV1 }
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" };

type DirectionTakes = Record<LogoDirectionId, readonly LogoDirectionPart[]>;

function emptyTakes(): DirectionTakes {
  return { "direction-1": [], "direction-2": [], "direction-3": [] };
}

async function readDirections(projectId: string, signal: AbortSignal): Promise<DirectionRead> {
  let raw: string;
  try {
    raw = await readProjectFileText(projectId, LOGO_DIRECTIONS_FILE, signal);
  } catch (error) {
    // The route reports a missing project file as ApiError; that is the empty state, not a fault.
    if (error instanceof ApiError && error.status === 404) return { kind: "empty" };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    // A half-written file is expected while the agent works: an explicit invalid state, not a crash.
    if (error instanceof SyntaxError) return { kind: "invalid" };
    throw error;
  }
  try {
    return { kind: "ready", directions: parseLogoDirectionsV1(json) };
  } catch (error) {
    if (error instanceof UpgradeContractError) return { kind: "invalid" };
    throw error;
  }
}

/**
 * The Idea step: three directions presented as large mark-plus-wordmark lockups
 * on a positive and a negative plate. Picking selects one card for a single
 * primary "use" action; mixing takes explicit parts from any card and adopts them
 * through the same action. The sketch is the transparent SVG file the direction
 * names, rendered as an <img> with a revision cache-buster; the wordmark is the
 * brand name set in HTML, never added to the file.
 */
export default function LogoDirectionPanel({
  projectId,
  disabled,
  onAction,
}: {
  readonly projectId: string;
  readonly disabled: boolean;
  readonly onAction: (action: LogoActionV1) => void;
}) {
  const t = useT();
  const [mixing, setMixing] = useState(false);
  const [take, setTake] = useState<DirectionTakes>(emptyTakes);
  const [selected, setSelected] = useState<LogoDirectionId | null>(null);

  useEffect(() => {
    setMixing(false);
    setTake(emptyTakes());
    setSelected(null);
  }, [projectId]);

  const directionsQuery = useQuery({
    queryKey: ["projects", projectId, "logo-directions"],
    queryFn: ({ signal }) => readDirections(projectId, signal),
    retry: false,
  });

  // New ideas reuse the positional ids, so a pick made on the old set must not carry over.
  // Structural sharing keeps the same data reference when a refetch changes nothing.
  useEffect(() => {
    setTake(emptyTakes());
    setSelected(null);
  }, [directionsQuery.data]);

  const picks = useMemo<readonly LogoAdoptPick[]>(
    () =>
      LOGO_DIRECTION_IDS.flatMap((id) => {
        const parts = take[id];
        return parts.length === 0 ? [] : [{ direction_id: id, take: parts }];
      }),
    [take],
  );

  if (directionsQuery.isPending) return (
    <section aria-label={t("logo.pipeline.idea")} className="flex min-h-full items-center justify-center bg-card p-6">
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        {t("logo.pipeline.working")}
      </p>
    </section>
  );
  if (directionsQuery.isError) return (
    <section aria-label={t("logo.pipeline.idea")} className="flex min-h-full flex-col items-center justify-center gap-3 bg-card p-6 text-center">
      <p role="alert" className="max-w-sm text-sm leading-6 text-foreground">{apiErrorCopy(directionsQuery.error)}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void directionsQuery.refetch()}>
        {t("workspace.project.retry")}
      </Button>
    </section>
  );
  const read: DirectionRead = directionsQuery.data ?? { kind: "empty" };
  const directions = read.kind === "ready" ? read.directions.directions : [];
  const chosen = selected === null ? undefined : directions.find((direction) => direction.id === selected);
  const ready = mixing ? picks.length > 0 : chosen !== undefined;
  const nameOf = (id: LogoDirectionId) => directions.find((direction) => direction.id === id)?.name ?? id;

  const togglePart = (id: LogoDirectionId, part: LogoDirectionPart) => {
    setTake((previous) => {
      const current = previous[id];
      return {
        ...previous,
        [id]: current.includes(part) ? current.filter((entry) => entry !== part) : [...current, part],
      };
    });
  };
  const adopt = () => {
    if (mixing) {
      if (picks.length > 0) onAction({ action: "adopt", picks });
      return;
    }
    if (chosen !== undefined) onAction({ action: "adopt", picks: [{ direction_id: chosen.id, take: [...LOGO_DIRECTION_PARTS] }] });
  };
  const generateIdeas = () => onAction({ action: "ideate" });

  return (
    <section
      aria-label={t("logo.pipeline.idea")}
      aria-busy={disabled}
      className="flex min-h-full min-w-0 flex-col gap-4 bg-card px-4 pt-4 sm:px-6 sm:pt-5"
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 basis-full text-lg font-semibold leading-7 text-foreground sm:basis-auto">
          {t("logo.pipeline.chooseDirection")}
        </h2>
        {read.kind === "ready" ? (
          <>
            <div role="group" aria-label={t("logo.pipeline.modeLabel")} className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
              <button
                type="button"
                aria-pressed={!mixing}
                  disabled={disabled}
                onClick={() => setMixing(false)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mixing ? "text-muted-foreground hover:text-foreground" : "bg-card text-foreground shadow-app-1",
                )}
              >
                {t("logo.pipeline.modePick")}
              </button>
              <button
                type="button"
                aria-pressed={mixing}
                  disabled={disabled}
                onClick={() => setMixing(true)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mixing ? "bg-card text-foreground shadow-app-1" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Shuffle aria-hidden="true" className="h-4 w-4" />
                {t("logo.pipeline.mixDirections")}
              </button>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 shrink-0 max-sm:w-11 max-sm:px-0"
              disabled={disabled}
              onClick={generateIdeas}
            >
              <RefreshCw aria-hidden="true" />
              <span className="max-sm:sr-only">{t("logo.pipeline.regenerateIdeas")}</span>
            </Button>
          </>
        ) : null}
      </header>

      {read.kind === "invalid" ? (
        <EmptyState
          message={t("logo.pipeline.ideaInvalid")}
          actionLabel={t("logo.pipeline.regenerateIdeas")}
          disabled={disabled}
          onAction={generateIdeas}
        />
      ) : read.kind === "empty" ? (
        <EmptyState
          message={t("logo.pipeline.ideasEmpty")}
          actionLabel={t("logo.pipeline.generateIdeas")}
          disabled={disabled}
          onAction={generateIdeas}
        />
      ) : (
        <>
          <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {directions.map((direction) => (
              <li key={direction.id} className="min-w-0">
                <DirectionCard
                  projectId={projectId}
                  revision={directionsQuery.dataUpdatedAt}
                  brandName={read.directions.brand_name}
                  direction={direction}
                  mixing={mixing}
                  selected={selected === direction.id}
                  take={take[direction.id]}
                  disabled={disabled}
                  onSelect={() => setSelected(direction.id)}
                  onTogglePart={(part) => togglePart(direction.id, part)}
                />
              </li>
            ))}
          </ul>

          <footer className="sticky bottom-0 z-10 -mx-4 mt-auto flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div role="status" className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
              {mixing ? (
                picks.length === 0 ? t("logo.pipeline.mixEmpty") : (
                  <ul className="flex min-w-0 flex-wrap gap-1.5">
                    {picks.flatMap((pick) => pick.take.map((part) => (
                      <li key={`${pick.direction_id}:${part}`} className="max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-foreground">
                        <span className="text-muted-foreground">{t(PART_LABELS[part])}</span> {nameOf(pick.direction_id)}
                      </li>
                    )))}
                  </ul>
                )
              ) : chosen === undefined
                ? t("logo.pipeline.selectionRequired")
                : t("logo.pipeline.selectedDirection", { name: chosen.name })}
            </div>
            <Button type="button" variant="cta" className="min-h-11 shrink-0 px-5" disabled={disabled || !ready} onClick={adopt}>
              {mixing ? <Shuffle aria-hidden="true" /> : null}
              {t(mixing ? "logo.pipeline.useMix" : "logo.pipeline.useDirection")}
              {mixing ? null : <ArrowRight aria-hidden="true" />}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}

function EmptyState({
  message,
  actionLabel,
  disabled,
  onAction,
}: {
  readonly message: string;
  readonly actionLabel: string;
  readonly disabled: boolean;
  readonly onAction: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-10 pt-6 text-center">
      <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lightbulb className="h-6 w-6" />
      </span>
      <p className="max-w-sm text-sm leading-6 text-muted-foreground">{message}</p>
      <Button type="button" variant="cta" className="min-h-11 px-5" disabled={disabled} onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

function DirectionCard({
  projectId,
  revision,
  brandName,
  direction,
  mixing,
  selected,
  take,
  disabled,
  onSelect,
  onTogglePart,
}: {
  readonly projectId: string;
  readonly revision: number;
  readonly brandName: string;
  readonly direction: LogoDirectionV1;
  readonly mixing: boolean;
  readonly selected: boolean;
  readonly take: readonly LogoDirectionPart[];
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly onTogglePart: (part: LogoDirectionPart) => void;
}) {
  const t = useT();
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const src = `${projectFileUrl(projectId, direction.sketch.file)}?v=${revision}`;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  const plates = presentation(direction.color);
  const swatches = [direction.color.hero, ...direction.color.support, direction.color.ground];
  const moods = direction.mood.slice(0, VISIBLE_MOODS);
  const marked = mixing ? take.length > 0 : selected;

  const preview = (
    <>
      <span
        className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-4 p-6"
        style={{ backgroundColor: plates.light }}
      >
        {failed ? (
          <span className="text-sm" style={{ color: plates.wordmark }}>{t("logo.pipeline.sketchUnavailable")}</span>
        ) : (
          <img
            src={src}
            alt={`${direction.name} ${t("logo.pipeline.sketchAlt")}`}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailedSrc(src)}
            className="h-28 w-3/4 object-contain sm:h-32"
          />
        )}
        <span
          className="line-clamp-2 max-w-full break-words text-center text-xl font-semibold leading-tight tracking-[0.01em]"
          style={{ color: plates.wordmark }}
        >
          {brandName}
        </span>
        {mixing && !marked ? null : (
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              marked ? "bg-accent text-accent-foreground shadow-app-2" : "border border-black/15 bg-white/70",
            )}
          >
            {marked ? (mixing ? take.length : <Check className="h-4 w-4" strokeWidth={3} />) : null}
          </span>
        )}
      </span>
      <span className="flex h-16 items-center justify-center gap-3 px-4" style={{ backgroundColor: plates.dark }}>
        {failed ? null : (
          <img
            src={src}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-8 w-12 shrink-0 object-contain brightness-0 invert"
          />
        )}
        <span className="min-w-0 truncate text-base font-semibold tracking-[0.01em] text-white">{brandName}</span>
      </span>
    </>
  );

  return (
    <article
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-shadow has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring has-[>button:focus-visible]:ring-offset-2 has-[>button:focus-visible]:ring-offset-card",
        marked ? "border-foreground/50 shadow-app-3" : "border-border shadow-app-1",
        !mixing && !marked && "hover:shadow-app-2",
      )}
    >
      {mixing ? (
        <div className="block">{preview}</div>
      ) : (
        <button
          type="button"
          aria-pressed={selected}
          disabled={disabled}
          aria-label={direction.name}
          onClick={onSelect}
          className="block w-full text-left outline-none focus-visible:outline-none"
        >
          {preview}
        </button>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="min-w-0 truncate text-base font-semibold text-foreground" title={direction.name}>
            {direction.name}
          </h3>
          <ul aria-label={t("logo.pipeline.color")} className="flex shrink-0 -space-x-1">
            {swatches.map((hex, index) => (
              <li
                key={`${hex}-${index}`}
                role="img"
                aria-label={hex}
                title={hex}
                style={{ backgroundColor: hex }}
                className="h-5 w-5 rounded-full border border-black/10 ring-2 ring-card"
              />
            ))}
          </ul>
        </div>
        <p className="truncate text-sm leading-relaxed text-muted-foreground">{leadSentence(direction.rationale)}</p>
        <ul aria-label={t("logo.pipeline.mood")} className="flex min-w-0 flex-wrap gap-1.5">
          {moods.map((word, index) => (
            <li key={`${word}-${index}`} className="max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
              {word}
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
          className="-ml-2 mt-auto inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t(expanded ? "logo.pipeline.less" : "logo.pipeline.more")}
          <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
        <dl
          id={detailsId}
          hidden={!expanded}
          className={cn("gap-3 rounded-lg bg-muted/60 p-3 text-sm", expanded ? "grid" : "hidden")}
        >
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t("logo.pipeline.rationale")}</dt>
            <dd className="mt-1 leading-relaxed text-foreground">{direction.rationale}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t("logo.pipeline.shape")}</dt>
            <dd className="mt-1 leading-relaxed text-foreground">{direction.shape.construction}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t("logo.pipeline.logoType")}</dt>
            <dd className="mt-1 text-foreground">{t(`home.logo.type.${direction.logo_type}`)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t("logo.pipeline.color")}</dt>
            <dd className="mt-1">
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {swatches.map((hex, index) => (
                  <li key={`${hex}-${index}`} className="inline-flex items-center gap-1.5 text-xs tabular-nums text-foreground">
                    <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-black/10" style={{ backgroundColor: hex }} />
                    {hex}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          {direction.mood.length > moods.length ? (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t("logo.pipeline.mood")}</dt>
              <dd className="mt-1 text-foreground">{direction.mood.join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {mixing ? (
        <div className="border-t border-border p-3">
          <ul aria-label={t("logo.pipeline.mixPartsFor", { name: direction.name })} className="grid grid-cols-4 gap-1.5">
            {LOGO_DIRECTION_PARTS.map((part) => {
              const active = take.includes(part);
              return (
                <li key={part} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    disabled={disabled}
                    onClick={() => onTogglePart(part)}
                    className={cn(
                      "inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                      active ? "bg-accent/10 text-accent" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {active ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}
                    <span className="truncate">{t(PART_LABELS[part])}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The plates a lockup is shown on. The palette's own ground is used when it is
 * already a near-white or near-black; the wordmark takes the hero (then a
 * support colour) only when it stays legible on the positive plate.
 */
function presentation(color: LogoDirectionV1["color"]): { readonly light: string; readonly dark: string; readonly wordmark: string } {
  const ground = luminance(color.ground);
  const light = ground >= 0.8 ? color.ground : LIGHT_PLATE;
  const dark = ground <= 0.03 ? color.ground : DARK_PLATE;
  const wordmark = [color.hero, ...color.support].find((hex) => contrast(hex, light) >= 4.5) ?? INK;
  return { light, dark, wordmark };
}

/** WCAG relative luminance of a parser-validated #RRGGBB colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The first sentence of the rationale for the card face; the full text stays behind More. */
function leadSentence(text: string): string {
  const end = /[.!?。！？](?:\s|$)/u.exec(text);
  return end === null ? text : text.slice(0, end.index + 1);
}
