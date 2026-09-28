import {
  parseVisualAlternativeList,
  type CreateVisualAlternativesRequest,
  type VisualAlternativeList,
} from "@bg/shared";
import { apiFetch } from "./client";

export async function getVisualAlternatives(
  projectId: string,
): Promise<VisualAlternativeList | null> {
  const value = await apiFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/alternatives`,
  );
  return value === null ? null : parseVisualAlternativeList(value);
}

export async function generateVisualAlternatives(
  projectId: string,
  request: CreateVisualAlternativesRequest,
): Promise<VisualAlternativeList> {
  return parseVisualAlternativeList(await apiFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/alternatives/generate`,
    { method: "POST", body: JSON.stringify(request) },
  ));
}

export function promoteVisualAlternative(
  projectId: string,
  alternativeId: string,
  identity: {
    readonly expected_revision: number;
    readonly expected_artifact_digest: string;
  },
): Promise<{
  readonly operation_id: string;
  readonly result_revision: number;
  readonly result_digest: string;
}> {
  return apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/alternatives/${encodeURIComponent(alternativeId)}/promote`,
    { method: "POST", body: JSON.stringify(identity) },
  );
}

export function deleteVisualAlternative(
  projectId: string,
  alternativeId: string,
): Promise<void> {
  return apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/alternatives/${encodeURIComponent(alternativeId)}`,
    { method: "DELETE" },
  );
}

export function cancelVisualAlternatives(projectId: string): Promise<{ readonly cancelled: true }> {
  return apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/alternatives/cancel`,
    { method: "POST" },
  );
}
