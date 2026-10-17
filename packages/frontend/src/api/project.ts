import type {
  ArtifactSummary,
  FileInfo,
  AppendProjectInstructionRequest,
  ProjectDetail,
  ProjectInstructions,
  PutProjectInstructionsRequest,
  SessionInfo,
} from "@bg/shared";
import { apiFetch } from "./client";

export async function getProject(id: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/api/projects/${id}`);
}

export async function showProjectFolder(id: string): Promise<void> {
  return apiFetch<void>(`/api/projects/${encodeURIComponent(id)}/show-folder`, { method: "POST" });
}

export async function getProjectInstructions(id: string): Promise<ProjectInstructions> {
  return apiFetch<ProjectInstructions>(`/api/projects/${encodeURIComponent(id)}/instructions`);
}

export async function saveProjectInstructions(id: string, body: PutProjectInstructionsRequest): Promise<ProjectInstructions> {
  return apiFetch<ProjectInstructions>(`/api/projects/${encodeURIComponent(id)}/instructions`, { method: "PUT", body: JSON.stringify(body) });
}

export async function appendProjectInstruction(id: string, body: AppendProjectInstructionRequest): Promise<ProjectInstructions> {
  return apiFetch<ProjectInstructions>(`/api/projects/${encodeURIComponent(id)}/instructions/lines`, { method: "POST", body: JSON.stringify(body) });
}

export async function getProjectSession(id: string): Promise<SessionInfo> {
  return apiFetch<SessionInfo>(`/api/projects/${id}/session`);
}

export async function listProjectFiles(id: string): Promise<FileInfo[]> {
  return apiFetch<FileInfo[]>(`/api/projects/${id}/files`);
}

export async function getArtifacts(id: string): Promise<ArtifactSummary> {
  return apiFetch<ArtifactSummary>(`/api/projects/${id}/artifacts`);
}

export async function refreshArtifacts(id: string): Promise<ArtifactSummary> {
  return apiFetch<ArtifactSummary>(`/api/projects/${id}/refresh`, {
    method: "POST",
  });
}
