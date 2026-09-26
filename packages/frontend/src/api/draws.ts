import { apiFetch, authorizedFetch } from "./client";

const SAFE_LIMIT_BYTES = 2_000_000;

function encode(relPath: string): string {
  return relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function getProjectDraws(
  projectId: string,
  relPath: string,
): Promise<string> {
  const res = await authorizedFetch(`/api/projects/${projectId}/draws/${encode(relPath)}`);
  if (!res.ok) {
    throw new Error(`draws_fetch_failed: ${res.status}`);
  }
  return await res.text();
}

/** Artifact identity the draws PUT anchors the overlay to. */
export interface DrawsIdentity {
  readonly revision: number;
  readonly digest: string;
  /** "<width>x<height>" of the canvas the strokes were drawn on. */
  readonly viewport?: string;
}

export async function putProjectDraws(
  projectId: string,
  relPath: string,
  svg: string,
  identity: DrawsIdentity,
): Promise<{ rel_path: string; bytes: number }> {
  if (svg.length > SAFE_LIMIT_BYTES) {
    throw new Error("svg_too_large");
  }
  const headers: Record<string, string> = {
    "Content-Type": "image/svg+xml",
    "x-burnguard-revision": String(identity.revision),
    "if-match": `"${identity.digest}"`,
  };
  if (identity.viewport) headers["x-burnguard-viewport"] = identity.viewport;
  return apiFetch<{ rel_path: string; bytes: number }>(
    `/api/projects/${projectId}/draws/${encode(relPath)}`,
    {
      method: "PUT",
      headers,
      body: svg,
    },
  );
}
