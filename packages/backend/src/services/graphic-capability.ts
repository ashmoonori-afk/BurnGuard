import { canGenerateGraphics, type BackendDetection } from "@bg/shared";

/**
 * Whether a graphic project may run on this backend with this model selection.
 *
 * Graphic projects need a backend that can produce raster imagery. The rule used to be "Codex, and
 * logged in", duplicated inline at project creation, turn start and turn execution. It is now the
 * declared image capability of the backend and the selected model, so any provider that can draw
 * qualifies and Codex keeps behaving exactly as it did.
 */
export function isGraphicCapableBackend(
  backend: BackendDetection | undefined,
  modelId: string,
): boolean {
  return canGenerateGraphics(backend, modelId);
}

/**
 * Throws the shared refusal when the backend cannot draw. The error code is unchanged so existing
 * clients, the sanitizer and the error card keep resolving it; only the user-facing copy was
 * corrected, because the requirement is no longer Codex-specific.
 */
export function ensureGraphicCapableBackend(
  backend: BackendDetection | undefined,
  modelId: string,
): void {
  if (!isGraphicCapableBackend(backend, modelId)) throw new Error("graphic_requires_authenticated_codex");
}

/**
 * Whether this backend could draw with SOME model it offers. Project creation and turn admission ask
 * this, because no model is selected yet at creation and refusing on the default selection would
 * block a provider whose first listed model happens to be text-only. Turn execution then re-checks
 * the model the turn actually resolved.
 */
export function backendCanEverGenerateGraphics(backend: BackendDetection | undefined): boolean {
  if (!backend?.found || backend.authenticated === false) return false;
  if (backend.image_generation === true) return true;
  return (backend.models ?? []).some((model) => model.image_generation === true);
}
