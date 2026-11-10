/**
 * Artifact identity for optimistic concurrency (T1).
 *
 * Every mutating artifact route requires the caller to prove which revision
 * it read. The project-wide identity comes from
 * `GET /api/projects/:id/artifacts`; the per-file identity
 * (`expected_file_hash`, `node_fingerprint`) is only available from the
 * response headers of the managed-file GET, so read it right before a PATCH.
 */
import { ApiError, authorizedFetch } from "@/api/client";

export interface FileArtifactIdentity {
  readonly expected_revision: number;
  readonly expected_artifact_digest: string;
  readonly expected_file_hash: string;
  readonly node_fingerprint: string;
}

export type IdentityFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

function encodeRelPath(relPath: string): string {
  return relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Reads the current identity of one node in one managed file. Throws an
 * ApiError when the file is gone, the node no longer exists, or the backend
 * omits an identity header (never returns a partial identity).
 */
export async function readFileIdentity(
  projectId: string,
  relPath: string,
  nodeBgId: string,
  fetchImpl: IdentityFetch = authorizedFetch,
): Promise<FileArtifactIdentity> {
  const res = await fetchImpl(
    `/api/projects/${projectId}/fs/${encodeRelPath(relPath)}?node_bg_id=${encodeURIComponent(nodeBgId)}`,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      body?.error?.code ?? "artifact_identity_unavailable",
      body?.error?.message ?? `Artifact identity unavailable (HTTP ${res.status})`,
      res.status,
    );
  }
  const rawRevision = res.headers.get("x-burnguard-revision");
  // Number(null) is 0, so an absent header must fail before the numeric check.
  const revision = rawRevision === null ? Number.NaN : Number(rawRevision);
  const digest = res.headers.get("x-burnguard-artifact-digest");
  const fileHash = res.headers.get("x-burnguard-file-hash");
  const fingerprint = res.headers.get("x-burnguard-node-fingerprint");
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !digest ||
    !fileHash ||
    !fingerprint
  ) {
    throw new ApiError(
      "artifact_identity_unavailable",
      "Artifact identity headers are missing",
      res.status,
    );
  }
  return {
    expected_revision: revision,
    expected_artifact_digest: digest,
    expected_file_hash: fileHash,
    node_fingerprint: fingerprint,
  };
}

/**
 * A canvas gesture reads the identity when it starts and saves against that one, so a change that lands while the
 * pointer is still down is refused as stale. Anything that commits at once reads the identity at save time.
 */
export function identityForPatch(
  gestureStart: Promise<FileArtifactIdentity> | undefined,
  readNow: () => Promise<FileArtifactIdentity>,
): Promise<FileArtifactIdentity> {
  return gestureStart ?? readNow();
}

/** True when the server rejected a write because the canvas moved on. */
export function isStaleIdentityError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (
    error.status === 409 ||
    error.status === 412 ||
    error.code === "stale_artifact_identity"
  );
}
