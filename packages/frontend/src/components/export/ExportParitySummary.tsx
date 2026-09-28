import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type {
  ExportParitySummary as ExportParitySummaryDto,
  ExportParityWarning,
} from "@bg/shared";
import { useT } from "@/i18n/t";
import type { MessageKey } from "@/i18n/messages";

const WARNING_KEY = {
  page_count_mismatch: "export.parity.warning.page_count_mismatch",
  dimension_mismatch: "export.parity.warning.dimension_mismatch",
  similarity_below_threshold:
    "export.parity.warning.similarity_below_threshold",
  comparison_unavailable: "export.parity.warning.comparison_unavailable",
} as const satisfies Record<ExportParityWarning, MessageKey>;

export function parityWarningKey(warning: ExportParityWarning): MessageKey {
  return WARNING_KEY[warning];
}

export function parityThumbnailUrl(jobId: string, page: number): string {
  return `/api/exports/${encodeURIComponent(jobId)}/parity/pages/${page}/thumbnail`;
}

export default function ExportParitySummary({
  jobId,
  parity,
}: {
  readonly jobId: string;
  readonly parity: ExportParitySummaryDto;
}) {
  const t = useT();
  const passed = parity.status === "pass";
  const Icon = passed ? CheckCircle2 : AlertTriangle;
  const warnings = [
    ...parity.warnings,
    ...parity.pages.flatMap((page) => page.warnings),
  ].filter((warning, index, all) => all.indexOf(warning) === index);
  return (
    <section className="ml-6 space-y-1.5 rounded-md bg-muted/55 p-2">
      <div className="flex items-center gap-1.5">
        <Icon
          className={`h-3.5 w-3.5 ${
            passed ? "text-success" : "text-warning"
          }`}
          aria-hidden="true"
        />
        <span className="text-[10px] font-medium text-foreground">
          {t(passed ? "export.parity.pass" : "export.parity.warn")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {t(
            parity.comparison === "pixel"
              ? "export.parity.pixel"
              : "export.parity.structural",
          )}
        </span>
      </div>
      {warnings.length > 0 && (
        <ul className="space-y-0.5 text-[10px] text-muted-foreground">
          {warnings.map((warning) => (
            <li key={warning}>{t(parityWarningKey(warning))}</li>
          ))}
        </ul>
      )}
      {parity.pages.map((page) => (
        <figure key={page.page} className="space-y-1">
          <figcaption className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>{t("export.parity.page", { count: page.page })}</span>
            <span className="font-mono">
              {page.source_dimensions.width}×{page.source_dimensions.height}
              {" → "}
              {page.output_dimensions.width}×{page.output_dimensions.height}
              {page.similarity_score === null
                ? ""
                : ` · ${t("export.parity.score", {
                    count: page.similarity_score,
                  })}`}
            </span>
          </figcaption>
          {page.thumbnail_available && (
            <img
              src={parityThumbnailUrl(jobId, page.page)}
              alt={t("export.parity.thumbnailAlt", { count: page.page })}
              width={320}
              height={100}
              loading="lazy"
              className="h-auto w-full rounded border border-border bg-background"
            />
          )}
        </figure>
      ))}
    </section>
  );
}
