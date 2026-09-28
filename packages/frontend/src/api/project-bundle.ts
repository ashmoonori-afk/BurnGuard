import type { ProjectBundleImportResponse } from "@bg/shared";
import { t } from "@/i18n/t";
import { apiFetch, ApiError, authorizedFetch } from "./client";

export async function readProjectBundleDownload(projectId: string): Promise<{
  readonly blob: Blob;
  readonly filename: string;
}> {
  const response = await authorizedFetch(`/api/projects/${projectId}/bundle`);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && "error" in body && body.error &&
      typeof body.error === "object" && "code" in body.error && typeof body.error.code === "string"
      ? body.error.code
      : "project_bundle_unavailable";
    throw new ApiError(code, t("errors.fallback"), response.status);
  }
  return {
    blob: await response.blob(),
    filename: projectBundleFilename(response.headers.get("content-disposition")),
  };
}

export async function importProjectBundle(
  file: File,
  name: string,
): Promise<ProjectBundleImportResponse> {
  const body = new FormData();
  body.set("name", name.trim());
  body.set("source", "bundle");
  body.set("files", file);
  return apiFetch<ProjectBundleImportResponse>("/api/projects/import", {
    method: "POST",
    body,
  });
}

export function projectBundleFilename(disposition: string | null): string {
  const value = disposition ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try { return safeFilename(decodeURIComponent(encoded)); }
    catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
  }
  return safeFilename(/filename="([^"\r\n]+)"/i.exec(value)?.[1] ?? "BurnGuard-project.burnguard-project");
}

function safeFilename(value: string): string {
  return value.replace(/[\\/]/g, "_");
}
