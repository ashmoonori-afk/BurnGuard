import { parseDesignDirectionState, type DesignDirectionState, type GenerationStyle } from "@bg/shared";
import { apiFetch } from "./client";

/**
 * Design-direction workflow client. Every response body crosses the trust
 * boundary through the shared contract parser exactly once, so the rest of
 * the frontend only ever handles a typed `DesignDirectionState`.
 */

export type DirectionSelectionInput = {
  readonly generation_id: string;
  readonly expected_selection_revision: number;
  readonly direction_id: string;
};

export type DirectionUndoInput = {
  readonly generation_id: string;
  readonly expected_selection_revision: number;
};

function base(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/design-directions`;
}

function parseState(payload: unknown): DesignDirectionState {
  return parseDesignDirectionState(payload);
}

/** Recovery-aware read. `null` means the session has never generated directions. */
export async function getDesignDirectionState(
  projectId: string,
): Promise<DesignDirectionState | null> {
  const payload = await apiFetch<unknown>(base(projectId));
  return payload === null ? null : parseState(payload);
}

export async function generateDesignDirections(
  projectId: string,
  preferences?: GenerationStyle,
): Promise<DesignDirectionState> {
  return parseState(await apiFetch<unknown>(`${base(projectId)}/generate`, { method: "POST", ...(preferences === undefined ? {} : { body: JSON.stringify(preferences) }) }));
}

export async function saveDirectionPreferences(projectId: string, input: DirectionUndoInput & { readonly creative_preferences: GenerationStyle }): Promise<DesignDirectionState> {
  return parseState(await apiFetch<unknown>(`${base(projectId)}/preferences`, { method: "POST", body: JSON.stringify(input) }));
}

/** Retries every failed or cancelled slot of the current generation. */
export async function retryDesignDirections(
  projectId: string,
): Promise<DesignDirectionState> {
  return parseState(await apiFetch<unknown>(`${base(projectId)}/retry`, { method: "POST" }));
}

export async function cancelDesignDirections(
  projectId: string,
): Promise<DesignDirectionState> {
  return parseState(
    await apiFetch<unknown>(`${base(projectId)}/cancel`, { method: "POST" }),
  );
}

export async function selectDesignDirection(
  projectId: string,
  input: DirectionSelectionInput,
): Promise<DesignDirectionState> {
  return parseState(
    await apiFetch<unknown>(`${base(projectId)}/select`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function undoDesignDirectionSelection(
  projectId: string,
  input: DirectionUndoInput,
): Promise<DesignDirectionState> {
  return parseState(
    await apiFetch<unknown>(`${base(projectId)}/undo-selection`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}
