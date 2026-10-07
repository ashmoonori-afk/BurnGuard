import { parseLogoMoodboardV1, type LogoMoodboardV1 } from "@bg/shared";
import { apiFetch } from "./client";

/**
 * Project logo moodboard client (doc/23). A board is a revisioned list of
 * uploaded reference images and bookmarked HTTPS links; links are metadata
 * only and the app never fetches them. Every mutation carries the revision it
 * was built against (`expected_revision`) so the backend rejects a stale write,
 * and every response body crosses the trust boundary through the shared parser
 * exactly once.
 */

function boardPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/logo/moodboard`;
}

/**
 * Raw image endpoint for one uploaded reference. Like the artifact file route,
 * this serves bytes rather than the API envelope, so it is safe to hand
 * straight to an `<img src>`: the launch cookie carries the authority the
 * capability header would.
 */
export function moodboardFileUrl(projectId: string, fileId: string): string {
  return `${boardPath(projectId)}/files/${encodeURIComponent(fileId)}`;
}

export async function getLogoMoodboard(
  projectId: string,
  signal?: AbortSignal,
): Promise<LogoMoodboardV1> {
  const payload = await apiFetch<unknown>(boardPath(projectId), {
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  return parseLogoMoodboardV1(payload);
}

export async function uploadMoodboardFiles(
  projectId: string,
  files: readonly File[],
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<LogoMoodboardV1> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  form.set("expected_revision", String(expectedRevision));
  const payload = await apiFetch<unknown>(`${boardPath(projectId)}/files`, {
    method: "POST",
    body: form,
    ...(signal === undefined ? {} : { signal }),
  });
  return parseLogoMoodboardV1(payload);
}

export async function addMoodboardLink(
  projectId: string,
  url: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<LogoMoodboardV1> {
  const payload = await apiFetch<unknown>(`${boardPath(projectId)}/links`, {
    method: "POST",
    body: JSON.stringify({ url, expected_revision: expectedRevision }),
    ...(signal === undefined ? {} : { signal }),
  });
  return parseLogoMoodboardV1(payload);
}

export async function removeMoodboardItem(
  projectId: string,
  itemId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<LogoMoodboardV1> {
  const payload = await apiFetch<unknown>(
    `${boardPath(projectId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ expected_revision: expectedRevision }),
      ...(signal === undefined ? {} : { signal }),
    },
  );
  return parseLogoMoodboardV1(payload);
}
