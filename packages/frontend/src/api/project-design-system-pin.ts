import type { CanonicalPinSelection, RefreshProjectDesignSystemPinRequest } from "@bg/shared/canonical-pin";
import type { ProjectDesignSystemPin } from "@bg/shared/project";
import { apiFetch } from "./client";

export function getProjectDesignSystemPin(projectId: string, selection?: CanonicalPinSelection): Promise<ProjectDesignSystemPin | null> {
  const query = selection === undefined ? "" : `?${new URLSearchParams([["format", selection.format], ["mode", selection.mode]])}`;
  return apiFetch<ProjectDesignSystemPin | null>(`/api/projects/${encodeURIComponent(projectId)}/design-system-pin${query}`);
}

export function refreshProjectDesignSystemPin(projectId: string, request: RefreshProjectDesignSystemPinRequest): Promise<ProjectDesignSystemPin | null> {
  return apiFetch<ProjectDesignSystemPin | null>(`/api/projects/${encodeURIComponent(projectId)}/design-system-pin`, {
    method: "POST", body: JSON.stringify(request),
  });
}
