import type {
  CreateFigmaApiImportRequest,
  CreateFigmaImportResponse,
  FigmaImportInspection,
  InspectFigmaImportRequest,
} from "@bg/shared/figma-import";
import { apiFetch } from "./client";

export async function inspectFigmaImport(projectId: string, request: InspectFigmaImportRequest): Promise<FigmaImportInspection> {
  return apiFetch<FigmaImportInspection>(`/api/projects/${projectId}/figma/inspect`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function importFigmaApi(projectId: string, request: CreateFigmaApiImportRequest): Promise<CreateFigmaImportResponse> {
  return apiFetch<CreateFigmaImportResponse>(`/api/projects/${projectId}/figma/import`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function importFigmaExport(projectId: string, body: FormData): Promise<CreateFigmaImportResponse> {
  return apiFetch<CreateFigmaImportResponse>(`/api/projects/${projectId}/figma/import`, {
    method: "POST",
    body,
  });
}
