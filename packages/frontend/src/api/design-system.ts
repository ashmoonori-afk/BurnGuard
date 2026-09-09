import type {
  CreateDesignSystemExtractionRequest,
  CreateDesignSystemExtractionResponse,
  CreateDesignSystemUploadRequest,
  CreateDesignSystemUploadResponse,
  DeleteDesignSystemResponse,
  DesignSystemFontUploadResponse,
  DesignSystemTokensResponse,
  UpsertDesignSystemColorRequest,
  DesignSystemPreview,
} from "@bg/shared";
import { apiFetch } from "./client";

export function extractPinterestMood(body: import("@bg/shared").CreatePinterestMoodRequest): Promise<import("@bg/shared").CreatePinterestMoodResponse> {
  return apiFetch("/api/design-systems/pinterest", { method: "POST", body: JSON.stringify(body) });
}

export async function listDesignSystemPreviews(id: string): Promise<DesignSystemPreview[]> {
  return apiFetch<DesignSystemPreview[]>(`/api/design-systems/${id}/previews`);
}

export async function extractDesignSystem(
  body: CreateDesignSystemExtractionRequest,
): Promise<CreateDesignSystemExtractionResponse> {
  return apiFetch<CreateDesignSystemExtractionResponse>(
    "/api/design-systems/extract",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function uploadDesignSystem(
  file: File,
  body?: CreateDesignSystemUploadRequest,
): Promise<CreateDesignSystemUploadResponse> {
  const form = new FormData();
  form.set("file", file);
  if (body?.name?.trim()) {
    form.set("name", body.name.trim());
  }
  if (body?.system_id?.trim()) {
    form.set("system_id", body.system_id.trim());
  }

  return apiFetch<CreateDesignSystemUploadResponse>(
    "/api/design-systems/upload",
    {
      method: "POST",
      body: form,
    },
  );
}

export async function getDesignSystemTokens(
  id: string,
): Promise<DesignSystemTokensResponse> {
  return apiFetch<DesignSystemTokensResponse>(`/api/design-systems/${id}/tokens`);
}

export async function upsertDesignSystemColor(
  id: string,
  body: UpsertDesignSystemColorRequest,
): Promise<DesignSystemTokensResponse> {
  return apiFetch<DesignSystemTokensResponse>(`/api/design-systems/${id}/colors`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function uploadDesignSystemFont(
  id: string,
  file: File,
  body: { family?: string; role?: "display" | "sans" | "serif" | "mono" | null },
): Promise<DesignSystemFontUploadResponse> {
  const form = new FormData();
  form.set("file", file);
  if (body.family?.trim()) {
    form.set("family", body.family.trim());
  }
  if (body.role) {
    form.set("role", body.role);
  }

  return apiFetch<DesignSystemFontUploadResponse>(
    `/api/design-systems/${id}/fonts`,
    {
      method: "POST",
      body: form,
    },
  );
}

export async function deleteDesignSystem(
  id: string,
): Promise<DeleteDesignSystemResponse> {
  return apiFetch<DeleteDesignSystemResponse>(`/api/design-systems/${id}`, {
    method: "DELETE",
  });
}
