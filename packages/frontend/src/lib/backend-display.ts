import { BACKEND_IDS, canGenerateGraphics, type BackendDetection, type BackendId } from "@bg/shared";

/**
 * Display name per backend. Exhaustive by type, so adding a `BackendId` without naming it fails the
 * build instead of silently rendering under another provider's name.
 */
export const BACKEND_LABELS: Readonly<Record<BackendId, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot",
  grok: "Grok",
};

export function backendLabel(id: BackendId): string {
  return BACKEND_LABELS[id];
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
    if (backend === undefined) return false;
    // Any model that draws qualifies: the model itself is chosen after creation.
    return canGenerateGraphics(backend, "")
      || (backend.models ?? []).some((model) => model.image_generation === true && canGenerateGraphics(backend, model.id));
  };
  if (capable(selected)) return selected;
  if (capable("codex")) return "codex";
  return BACKEND_IDS.find((id) => capable(id)) ?? "codex";
}
