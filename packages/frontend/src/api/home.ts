import type {
  BackendDetectionResult,
  CreateProjectRequest,
  CreateProjectResponse,
  DesignSystemSummary,
  ProjectSummary,
  SettingsPatch,
  SettingsSummary,
} from "@bg/shared";
import { ApiError, apiFetch } from "./client";

export async function listProjects(
  tab: "recent" | "mine" | "examples" = "recent",
): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>(`/api/projects?tab=${tab}`);
}

export async function listDesignSystems(
  status: "published" | "review" | "draft" | "all" = "published",
): Promise<DesignSystemSummary[]> {
  const systems = new Map<string, DesignSystemSummary>();
  // The catalog defaults to 50 items. Follow pages so imported systems stay selectable.
  for (let offset = 0; offset <= 10_000; offset += 100) {
    const filter = status === "all" ? "" : `status=${status}&`;
    const page = await apiFetch<DesignSystemSummary[]>(`/api/design-systems?${filter}lifecycle=active&limit=100&offset=${offset}`);
    for (const system of page) systems.set(system.id, system);
    if (page.length < 100) return [...systems.values()];
  }
  throw new ApiError("network_error", "Design system catalog exceeds the supported page range.", 502);
}

export async function createProject(
  body: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  return apiFetch<CreateProjectResponse>("/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function detectBackends(): Promise<BackendDetectionResult> {
  return apiFetch<BackendDetectionResult>("/api/backends/detect");
}

export async function getSettings(): Promise<SettingsSummary> {
  return apiFetch<SettingsSummary>("/api/settings");
}

export async function patchSettings(
  patch: SettingsPatch,
): Promise<SettingsSummary> {
  return apiFetch<SettingsSummary>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteProject(id: string): Promise<void> {
  // Must go through apiFetch: DELETE is capability-gated (403 without the
  // launch capability header). A 204 comes back as undefined.
  await apiFetch<void>(`/api/projects/${id}`, { method: "DELETE" });
}

export async function restoreSamples(): Promise<{ restored: boolean }> {
  return apiFetch<{ restored: boolean }>("/api/home/restore-samples", {
    method: "POST",
  });
}
