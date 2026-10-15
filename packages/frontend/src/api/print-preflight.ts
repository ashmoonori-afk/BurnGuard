import type { PrintPreflightV1 } from "@bg/shared/print-preflight";
import { apiFetch } from "./client";

export function getPrintPreflight(projectId: string): Promise<PrintPreflightV1> {
  return apiFetch<PrintPreflightV1>(`/api/projects/${encodeURIComponent(projectId)}/print-preflight`);
}
