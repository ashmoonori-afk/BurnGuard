import { BACKEND_IDS, canGenerateGraphics, type BackendDetection, type BackendDetectionResult, type BackendId } from "@bg/shared";
import { t, type MessageKey } from "@/i18n/t";

/**
 * Display name per backend. Exhaustive by type, so adding a `BackendId` without naming it fails the
 * build instead of silently rendering under another provider's name.
 */
export const BACKEND_LABELS: Readonly<Record<BackendId, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot",
};

export function backendLabel(id: BackendId): string {
  return BACKEND_LABELS[id];
}

/** Creation-panel option text: the product name, marked when the CLI is not installed. */
export function backendOptionLabel(backend: Pick<BackendDetection, "id" | "found">): string {
  return backend.found ? backendLabel(backend.id) : t("home.creation.backendNotFound", { name: backendLabel(backend.id) });
}

/**
 * The backend a graphic project should run on.
 *
 * Graphic work needs a backend that can draw. Codex keeps priority because it is what every existing
 * graphic project uses, and a selection that can already draw is respected rather than overridden.
 * When nothing capable is detected the choice stays Codex so the existing refusal explains why.
 */
export function graphicBackendId(
  backends: readonly BackendDetection[],
  selected: BackendId,
): BackendId {
  const capable = (id: BackendId): boolean => {
    const backend = backends.find((candidate) => candidate.id === id);
    return backend !== undefined && canDraw(backend);
  };
  if (capable(selected)) return selected;
  if (capable("codex")) return "codex";
  return BACKEND_IDS.find((id) => capable(id)) ?? "codex";
}

/** Any model that draws qualifies: the model itself is chosen after creation. */
function canDraw(backend: BackendDetection): boolean {
  return canGenerateGraphics(backend, "")
    || (backend.models ?? []).some((model) => model.image_generation === true && canGenerateGraphics(backend, model.id));
}

/** Home gates graphic and logo tiles on the same rule the creation panel and the send path use. */
export function hasGraphicBackend(backends: readonly BackendDetection[]): boolean {
  return backends.some(canDraw);
}

/** The creation panel's backend select lists only what detection reported; pending or failed detection is one disabled placeholder. */
export function backendSelectState(detection: { readonly isPending: boolean; readonly isError: boolean; readonly data?: BackendDetectionResult }): { readonly backends: readonly BackendDetection[]; readonly placeholder: MessageKey | null } {
  if (detection.data !== undefined) return { backends: detection.data.backends, placeholder: null };
  return { backends: [], placeholder: detection.isError ? "home.creation.detectionFailed" : "home.creation.detecting" };
}

/** Why a graphic tile is gated: detection never answered, or the only drawing backend is not signed in. */
export function graphicGateCopy(detectionFailed: boolean): { readonly title: MessageKey; readonly hint: MessageKey } {
  return detectionFailed
    ? { title: "home.detectionFailed", hint: "home.detectionFailed" }
    : { title: "home.codexRequired", hint: "home.graphicAvailability" };
}
