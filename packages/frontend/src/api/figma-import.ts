import type { CreateFigmaImportResponse } from "@bg/shared/figma-import";
import { apiFetch } from "./client";

export async function importFigmaExport(projectId: string, body: FormData): Promise<CreateFigmaImportResponse> {
  return apiFetch<CreateFigmaImportResponse>(`/api/projects/${projectId}/figma/import`, {
    method: "POST",
    body,
  });
}
