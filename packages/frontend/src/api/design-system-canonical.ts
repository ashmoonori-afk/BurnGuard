import { parseSemanticTheme, type DesignSystemCanonicalResponse } from "@bg/shared/theme";
import { apiFetch } from "./client";

export async function getDesignSystemCanonical(id: string): Promise<DesignSystemCanonicalResponse> {
  const response = await apiFetch<DesignSystemCanonicalResponse>(`/api/design-systems/${encodeURIComponent(id)}/canonical`);
  return response.theme === null ? response : { ...response, theme: parseSemanticTheme(response.theme) };
}
