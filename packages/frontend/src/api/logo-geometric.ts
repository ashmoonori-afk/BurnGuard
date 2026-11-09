import { parseLogoGeometricStatusV1, type LogoGeometricStatusV1 } from "@bg/shared";
import { apiFetch } from "./client";

/**
 * Geometric logo status client (doc/31). Read-only: the person's answers, approvals and revision
 * notes travel as turn sentinels on the ordinary send path. The body crosses the trust boundary
 * through the shared parser once.
 */
export async function getLogoGeometricStatus(projectId: string, signal?: AbortSignal): Promise<LogoGeometricStatusV1> {
  const payload = await apiFetch<unknown>(`/api/projects/${encodeURIComponent(projectId)}/logo/geometric`, {
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  return parseLogoGeometricStatusV1(payload);
}
