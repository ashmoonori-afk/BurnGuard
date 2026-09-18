import { useQuery } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { LOGO_FILES, LOGO_MAX_ROUNDS, type LogoActionV1, type LogoCandidateV1 } from "@bg/shared";
import { projectFileUrl, readProjectFileText } from "@/api/files";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";
import { latestLogoRound, parseProjectLogoManifest } from "@/lib/logo-project";

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
  if (manifest === null || round === null) return null;
  // The manifest contract caps history at LOGO_MAX_ROUNDS; past that a regenerate cannot append a round.
  const exhausted = manifest.rounds.length >= LOGO_MAX_ROUNDS;

  return (
    <section aria-label={t("logo.candidates.title")} className="shrink-0 border-t border-border bg-muted/60 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {t("logo.candidates.title")} · {t("logo.candidates.round", { count: round.round })}
        </p>
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
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-2">
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
    <div className="flex h-full flex-col gap-1.5 rounded-lg border border-border bg-background p-2">
      <img
        src={projectFileUrl(projectId, candidate.file)}
        alt={t("logo.candidates.preview", { number })}
        loading="lazy"
        decoding="async"
        className="aspect-square w-full rounded-md border border-border/60 bg-card object-contain"
      />
      <p className="truncate text-[11px] font-medium text-foreground" title={t(`home.logo.type.${candidate.logo_type}`)}>
        {number}. {t(`home.logo.type.${candidate.logo_type}`)}
      </p>
      <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground" title={candidate.rationale}>
        {candidate.rationale}
      </p>
      {selected ? (
        <p className="mt-auto flex min-h-9 items-center justify-center gap-1 rounded-md bg-accent-soft text-xs font-medium text-accent">
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
  );
}
