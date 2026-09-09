import type { ProjectPalette, PatchProjectPaletteRequest, PatchProjectPaletteResponse } from "@bg/shared";
import { apiFetch } from "./client";

export function getProjectPalette(projectId: string, relPath: string): Promise<ProjectPalette> {
  return apiFetch(`/api/projects/${projectId}/palette?path=${encodeURIComponent(relPath)}`);
}

export function patchProjectPalette(projectId: string, body: PatchProjectPaletteRequest): Promise<PatchProjectPaletteResponse> {
  return apiFetch(`/api/projects/${projectId}/palette`, { method: "PATCH", body: JSON.stringify(body) });
}
