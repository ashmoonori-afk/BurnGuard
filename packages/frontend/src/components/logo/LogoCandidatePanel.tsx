import { useQuery } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { LOGO_FILES, LOGO_MAX_ROUNDS, UpgradeContractError, parseLogoOriginalityReceiptV1, type LogoActionV1, type LogoCandidateV1 } from "@bg/shared";
import { ApiError } from "@/api/client";
import { projectFileUrl, readProjectFileText } from "@/api/files";
import { InfoTip } from "@/components/logo/LogoMoodboardPanel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";
import { latestLogoRound, parseProjectLogoManifest } from "@/lib/logo-project";
import { cn } from "@/lib/utils";

/**
 * The candidate picker of doc/23 D9. The manifest is the agent's own record of a
 * round, so it is read from the project tree rather than from a backend model:
 * until the first explore turn writes it there is nothing to show, and the panel
 * stays out of the way entirely.
 */
export default function LogoCandidatePanel({
  projectId,
  disabled,
  onAction,
}: {
  readonly projectId: string;
  readonly disabled: boolean;
  readonly onAction: (action: LogoActionV1) => void;
}) {
  const t = useT();
  const manifestQuery = useQuery({
    queryKey: ["projects", projectId, "logo-manifest"],
    queryFn: async ({ signal }) =>
      parseProjectLogoManifest(await readProjectFileText(projectId, LOGO_FILES.manifest, signal)),
    retry: false,
  });

  const manifest = manifestQuery.data ?? null;
  const round = manifest === null ? null : latestLogoRound(manifest);
  const receiptPath = manifest?.selected ? "logo-originality.json"
    : round ? `explorations/round-${round.round}/originality.json` : null;
  const screening = useQuery({
    queryKey: ["projects", projectId, "logo-originality", receiptPath],
    enabled: receiptPath !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      if (receiptPath === null) return null;
      try {
        return parseLogoOriginalityReceiptV1(JSON.parse(await readProjectFileText(projectId, receiptPath, signal)));
      } catch (error) {
        if ((error instanceof ApiError && error.status === 404) || error instanceof SyntaxError || error instanceof UpgradeContractError) return null;
        throw error;
      }
    },
  });
  if (manifest === null || round === null) return null;
  // The manifest contract caps history at LOGO_MAX_ROUNDS; past that a regenerate cannot append a round.
  const exhausted = manifest.rounds.length >= LOGO_MAX_ROUNDS;

  return (
    <section aria-label={t("logo.candidates.title")} className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {t("logo.candidates.title")} · {t("logo.candidates.round", { count: round.round })}
          </h2>
          <p role="status" className="flex min-w-0 flex-wrap gap-x-2 text-xs leading-5 text-muted-foreground">
            <span>{screening.isPending ? t("logo.pipeline.working") : screening.data
              ? t("logo.pipeline.checkedReferences", { count: screening.data.reference_count })
              : t("logo.pipeline.legacyUnchecked")}</span>
            {screening.data && screening.data.unchecked_link_count > 0 ? (
              <span>{t("logo.pipeline.uncheckedLinks", { count: screening.data.unchecked_link_count })}</span>
            ) : null}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          disabled={disabled || exhausted}
          title={exhausted ? t("logo.candidates.exhausted", { count: LOGO_MAX_ROUNDS }) : undefined}
          onClick={() => onAction({ action: "regenerate" })}
        >
          <RefreshCw aria-hidden="true" />
          {t("logo.candidates.regenerate")}
        </Button>
        <InfoTip label={t("logo.pipeline.screeningInfoLabel")}>{t("logo.pipeline.screeningNote")}</InfoTip>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 min-[901px]:grid-cols-4">
        {round.candidates.map((candidate) => (
          <li key={candidate.id}>
            <CandidateCard
              projectId={projectId}
              candidate={candidate}
              selected={manifest.selected?.round === round.round && manifest.selected.candidate_id === candidate.id}
              disabled={disabled}
              onSelect={() => onAction({ action: "select", round: round.round, candidate_id: candidate.id })}
            />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {disabled ? t("logo.candidates.busy") : exhausted ? t("logo.candidates.exhausted", { count: LOGO_MAX_ROUNDS }) : t("logo.candidates.hint")}
      </p>
    </section>
  );
}

function CandidateCard({
  projectId,
  candidate,
  selected,
  disabled,
  onSelect,
}: {
  readonly projectId: string;
  readonly candidate: LogoCandidateV1;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  const t = useT();
  const number = candidate.id.replace("candidate-", "");

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl border bg-card", selected ? "border-foreground/50 shadow-app-2" : "border-border")}>
      <div className="relative border-b border-border/60">
        <img
          src={projectFileUrl(projectId, candidate.file)}
          alt={t("logo.candidates.preview", { number })}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full bg-card object-contain"
        />
        {selected ? (
          <span aria-hidden="true" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-app-2">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <p className="truncate text-xs font-medium text-foreground" title={t(`home.logo.type.${candidate.logo_type}`)}>
          {number}. {t(`home.logo.type.${candidate.logo_type}`)}
        </p>
        <p className="line-clamp-2 text-xs leading-4 text-muted-foreground" title={candidate.rationale}>
          {candidate.rationale}
        </p>
        {selected ? (
          <p className="mt-auto flex min-h-11 items-center justify-center gap-1 rounded-md bg-accent/10 text-xs font-medium text-accent">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {t("logo.candidates.selected")}
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-auto min-h-11 w-full"
            disabled={disabled}
            aria-label={t("logo.candidates.selectNamed", { number })}
            onClick={onSelect}
          >
            {t("logo.candidates.select")}
          </Button>
        )}
      </div>
    </div>
  );
}
