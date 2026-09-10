import type { ExportFormat, ExportJob, ExportOptions } from "@bg/shared";
import { apiFetch, ApiError, authorizedFetch } from "./client";
import { getProject } from "./project";

export type { ExportFormat, ExportJob, ExportOptions };

/**
 * User-facing label per export format, used by ExportStatusList and
 * the error toast in ExportMenu so the user never sees the raw enum
 * value (`html_zip`, etc).
 */
export function formatLabel(format: ExportFormat): string {
  switch (format) {
    case "pdf":
      return "PDF";
    case "png":
      return "PNG";
    case "pptx":
      return "파워포인트";
    case "html_zip":
      return "HTML ZIP 파일";
    case "handoff":
      return "개발자 전달용";
    case "png_zip":
      return "프레임 ZIP";
    case "cafe24_package":
      return "카페24 패키지";
    case "imweb_package":
      return "아임웹 패키지";
  }
}

export async function createExport(
  projectId: string,
  format: ExportFormat,
  options?: ExportOptions,
): Promise<ExportJob> {
  return apiFetch<ExportJob>(`/api/projects/${projectId}/exports`, {
    method: "POST",
    body: JSON.stringify(options ? { format, options } : { format }),
  });
}

export async function listExports(projectId: string): Promise<ExportJob[]> {
  return apiFetch<ExportJob[]>(`/api/projects/${projectId}/exports`);
}

export async function getExport(id: string): Promise<ExportJob> {
  return apiFetch<ExportJob>(`/api/exports/${id}`);
}

export async function cancelExport(id: string): Promise<ExportJob> {
  return apiFetch<ExportJob>(`/api/exports/${id}/cancel`, { method: "POST" });
}

export async function retryExport(job: ExportJob): Promise<ExportJob> {
  const project = await getProject(job.project_id);
  return apiFetch<ExportJob>(`/api/exports/${job.id}/retry`, {
    method: "POST", body: JSON.stringify({ project_revision: project.current_revision, project_digest: project.current_digest }),
  });
}

export async function readExportDownload(id: string): Promise<{ blob: Blob; filename: string }> {
  const response = await authorizedFetch(`/api/exports/${id}/download`);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "code" in body.error && typeof body.error.code === "string" ? body.error.code : "export_not_ready";
    throw new ApiError(code, "Export download unavailable", response.status);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let filename = /filename="([^"\r\n]+)"/i.exec(disposition)?.[1] ?? "BurnGuard-export";
  if (encoded) { try { filename = decodeURIComponent(encoded); } catch {} }
  return { blob: await response.blob(), filename: filename.replace(/[\\/]/g, "_") };
}
