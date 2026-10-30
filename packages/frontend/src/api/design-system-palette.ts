import {
  parsePaletteState,
  type DesignSystemPaletteResponse,
  type SaveDesignSystemPaletteRequest,
} from "@bg/shared/palette";
import { apiFetch } from "./client";

export async function getDesignSystemPalette(id: string): Promise<DesignSystemPaletteResponse> {
  const response = await apiFetch<DesignSystemPaletteResponse>(`/api/design-systems/${encodeURIComponent(id)}/palette`);
  return { ...response, state: response.state === null ? null : parsePaletteState(response.state) };
}

export async function saveDesignSystemPalette(
  id: string,
  body: SaveDesignSystemPaletteRequest,
): Promise<DesignSystemPaletteResponse> {
  const response = await apiFetch<DesignSystemPaletteResponse>(`/api/design-systems/${encodeURIComponent(id)}/palette`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return { ...response, state: response.state === null ? null : parsePaletteState(response.state) };
}
