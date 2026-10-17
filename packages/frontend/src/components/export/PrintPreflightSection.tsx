import { useQuery } from "@tanstack/react-query";
import type { PrintPreflightV1 } from "@bg/shared/print-preflight";
import { useT } from "@/i18n/t";
import { getPrintPreflight } from "@/api/print-preflight";
import ProjectBundleButton from "@/components/project/ProjectBundleButton";
import { summarizePrintPreflight } from "./print-preflight-view";

const MAX_LISTED = 5;

export default function PrintPreflightSection({ projectId, enabled }: { readonly projectId: string; readonly enabled: boolean }) {
  const t = useT();
  const query = useQuery({ queryKey: ["project", projectId, "print-preflight"], queryFn: () => getPrintPreflight(projectId), enabled });
  if (!enabled) return null;
  return (
    <section aria-label={t("export.preflight.title")} className="mx-2 mb-2 space-y-1 rounded-md border border-border p-2 text-[11px]">
      <h3 className="text-xs font-medium">{t("export.preflight.title")}</h3>
      {query.isPending && <p className="text-muted-foreground">{t("export.preflight.loading")}</p>}
      {query.isError && <p role="alert">{t("export.preflight.failed")}</p>}
      {query.data !== undefined && <PreflightBody data={query.data} />}
      <p className="text-pretty break-keep text-muted-foreground">{t("export.preflight.bundleHint")}</p>
      <ProjectBundleButton projectId={projectId} />
    </section>
  );
}

function PreflightBody({ data }: { readonly data: PrintPreflightV1 }) {
  const t = useT();
  const view = summarizePrintPreflight(data);
  return (
    <ul className="space-y-0.5 text-pretty break-keep">
      {view.pages !== null && <li>{t("export.preflight.pages", { count: view.pages.count, size: view.pages.size })}</li>}
      <li>{view.missingFonts.length > 0 ? t("export.preflight.fontsMissing", { list: view.missingFonts.join(", ") }) : t("export.preflight.fontsOk")}</li>
      {view.remoteFonts.length > 0 && <li>{t("export.preflight.fontsRemote", { list: view.remoteFonts.join(", ") })}</li>}
      {view.lowImages.length === 0 && <li>{t("export.preflight.imagesOk")}</li>}
      {view.lowImages.slice(0, MAX_LISTED).map((image) => (
        <li key={`${image.page}-${image.locator}`} className={image.severity === "strong_warn" ? "text-destructive" : "text-warning-text"}>
          {t("export.preflight.imageLow", { page: image.page, locator: image.locator, ppi: Math.round(image.effective_ppi) })}
        </li>
      ))}
      {data.browser === "unusable" && <li>{t("export.preflight.browserUnusable")}</li>}
      {data.browser === "inconclusive" && <li>{t("export.preflight.browserInconclusive")}</li>}
      <li className="text-muted-foreground">{t("export.preflight.sourceUpscaling")}</li>
    </ul>
  );
}
