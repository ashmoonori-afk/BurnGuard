import { parsePhotoPlacementsV1, type PhotoPlacementsV1 } from "@bg/shared";
import { apiFetch } from "./client";

export type PhotoPlacementsView = { readonly state: "absent" | "invalid" | "present"; readonly record: PhotoPlacementsV1 | null };

export async function getProjectPhotoPlacements(projectId: string): Promise<PhotoPlacementsView> {
  const body = await apiFetch<{ readonly state: PhotoPlacementsView["state"]; readonly record: unknown }>(`/api/projects/${projectId}/photo-placements`);
  return { state: body.state, record: body.record === null ? null : parsePhotoPlacementsV1(body.record) };
}
