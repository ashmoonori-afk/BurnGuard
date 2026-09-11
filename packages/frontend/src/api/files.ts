import type { ArtifactHistoryV1, PatchFileRequest, PatchFileResponse } from "@bg/shared";
import { apiFetch } from "./client";

export function getArtifactHistory(projectId: string): Promise<ArtifactHistoryV1> {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/history`);
}
export function restoreArtifactHistory(projectId: string, operationId: string, history: ArtifactHistoryV1): Promise<{ operation_id: string; result_revision: number }> {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(operationId)}/undo`, { method: "POST", body: JSON.stringify({ expected_revision: history.current_revision, expected_artifact_digest: history.current_digest }) });
}

export interface FileUndoInfo {
  can_undo: boolean;
  stored_at: number | null;
}

export interface UndoFileResponse {
  rel_path: string;
  updated_at: number;
}

function encodePath(relPath: string): string {
  return relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function patchProjectFile(
  projectId: string,
  relPath: string,
  patch: PatchFileRequest,
): Promise<PatchFileResponse> {
  return apiFetch<PatchFileResponse>(
    `/api/projects/${projectId}/fs/${encodePath(relPath)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
}

export async function getFileUndoInfo(
  projectId: string,
  relPath: string,
): Promise<FileUndoInfo> {
  return apiFetch<FileUndoInfo>(
    `/api/projects/${projectId}/fs/${encodePath(relPath)}/undo-info`,
  );
}

export async function undoLastFilePatch(
  projectId: string,
  relPath: string,
): Promise<UndoFileResponse> {
  return apiFetch<UndoFileResponse>(
    `/api/projects/${projectId}/fs/${encodePath(relPath)}/undo`,
    { method: "POST" },
  );
}
