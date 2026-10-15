import { useQuery } from "@tanstack/react-query";
import { derivePhotoPlacementStatus, type PhotoPlacementStatus } from "@bg/shared";
import { useT, type MessageKey } from "@/i18n/t";
import { getProjectPhotoPlacements } from "@/api/photo-placements";

const STATUS_KEY: Readonly<Record<PhotoPlacementStatus, MessageKey>> = {
  reference_verified: "modes.photo.verified", unverified: "modes.photo.unverified", unsupported: "modes.photo.unsupported",
};
const MISSING_KEY = {
  reference_sources: "modes.photo.missing.sources", attachment_receipt: "modes.photo.missing.receipt", candidate_comparison: "modes.photo.missing.candidates",
} as const satisfies Record<string, MessageKey>;

/** Photographic placements beside their references and candidates; the status is derived from the record, never read from it. */
export default function PhotoPlacementsSection({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const query = useQuery({ queryKey: ["photo-placements", projectId], queryFn: () => getProjectPhotoPlacements(projectId) });
  const view = query.data;
  if (view === undefined || view.state === "absent") return null;
  if (view.state === "invalid" || view.record === null) return <section className="mt-4"><h3 className="mb-2 text-xs font-semibold">{t("modes.photo.title")}</h3><p className="text-xs text-muted-foreground">{t("modes.photo.invalid")}</p></section>;
  return (
    <section className="mt-4" aria-labelledby="photo-placements-title">
      <h3 id="photo-placements-title" className="mb-2 text-xs font-semibold">{t("modes.photo.title")}</h3>
      <div className="space-y-2">{view.record.placements.map((placement) => {
        const derived = derivePhotoPlacementStatus(placement);
        return (
          <article key={placement.id} className="rounded-md border border-border px-3 py-2 text-xs">
            <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words font-medium">{placement.purpose}</span><span className={derived.status === "reference_verified" ? "shrink-0 font-semibold" : "shrink-0 font-semibold text-warning"}>{t(STATUS_KEY[derived.status])}</span></div>
            {derived.missing.length > 0 && <ul className="mt-1 list-disc pl-4 text-muted-foreground">{derived.missing.map((item) => <li key={item}>{t(MISSING_KEY[item])}</li>)}</ul>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div><div className="font-medium">{t("modes.photo.references")}</div><ul className="mt-1 space-y-1 text-muted-foreground">{placement.references.map((reference) => <li key={reference.sha256} className="break-all">{reference.url} ({reference.licence})</li>)}</ul></div>
              <div><div className="font-medium">{t("modes.photo.candidates")}</div><ul className="mt-1 space-y-1 text-muted-foreground">{placement.candidates.map((candidate) => <li key={candidate.id} className="break-words">{candidate.id === placement.chosen_candidate ? `${t("modes.photo.chosen")}: ` : ""}{candidate.file}{candidate.rejected_reason === null ? "" : ` - ${candidate.rejected_reason}`}</li>)}</ul></div>
            </div>
            {placement.scale_facts.length > 0 && <ul className="mt-2 space-y-1 text-muted-foreground">{placement.scale_facts.map((fact) => <li key={fact.claim} className="break-words">{fact.claim} ({t(fact.status === "verified" ? "modes.photo.scaleVerified" : "modes.photo.scaleEstimated")})</li>)}</ul>}
          </article>
        );
      })}</div>
    </section>
  );
}
