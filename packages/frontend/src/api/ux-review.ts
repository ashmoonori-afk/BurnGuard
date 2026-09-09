import { parseUxReviewReport, type UxReviewReport } from "@bg/shared";
import { apiFetch } from "./client";

export async function getUxReview(projectId: string, path: string, signal?: AbortSignal): Promise<UxReviewReport> {
  return parseUxReviewReport(await apiFetch<unknown>(`/api/projects/${encodeURIComponent(projectId)}/ux-review?path=${encodeURIComponent(path)}`, { signal }));
}
