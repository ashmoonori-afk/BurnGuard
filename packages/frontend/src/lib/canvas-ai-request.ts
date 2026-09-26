import { t } from "@/i18n/t";

/**
 * Chart and 3D panels hand their "save and ask AI" instruction to the ordinary send path. The
 * file and chart identities stay JSON-quoted in every locale; only the surrounding sentence is
 * localized, and the user's own request follows on its own line.
 */
export function chartAiRequest(relPath: string, chartId: string, request: string): string {
  return `${t("canvas.chart.aiRequestTemplate", { file: JSON.stringify(relPath), chart: JSON.stringify(chartId) })}\n${request.trim()}`;
}

export function threeSceneAiRequest(relPath: string, request: string): string {
  return `${t("canvas.three.aiRequestTemplate", { file: JSON.stringify(relPath) })}\n${request.trim()}`;
}
