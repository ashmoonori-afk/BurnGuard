import type { BackendDetection, BackendId, ProjectSummary } from "@bg/shared";
import type { MessageKey } from "@/i18n/t";

export const FIRST_RUN_DISMISSED_KEY = "burnguard.first-run-dismissed";

export function readFirstRunDismissed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(FIRST_RUN_DISMISSED_KEY) === "1";
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}

export function dismissFirstRun(): void {
  try {
    window.localStorage.setItem(FIRST_RUN_DISMISSED_KEY, "1");
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

/** Template-created user projects also appear in Examples, so Mine alone cannot establish a first launch. */
export function shouldShowFirstRun(
  dismissed: boolean,
  mine: readonly ProjectSummary[] | undefined,
  examples: readonly ProjectSummary[] | undefined,
): boolean {
  return !dismissed && mine !== undefined && examples !== undefined
    && [...mine, ...examples].every((project) => project.is_bundled === true);
}

export function firstRunBackend(backends: readonly BackendDetection[], preferred: BackendId): BackendId {
  const ready = backends.filter((backend) => backend.found && !backend.probe_failed);
  return ready.find((backend) => backend.authenticated === true)?.id
    ?? ready.find((backend) => backend.id === preferred)?.id
    ?? ready[0]?.id
    ?? preferred;
}

export function firstRunConnectionState(backend: BackendDetection): "missing" | "probe-failed" | "signed-in" | "sign-in-required" | "unknown" {
  if (!backend.found) return "missing";
  if (backend.probe_failed) return "probe-failed";
  if (backend.authenticated === true) return "signed-in";
  if (backend.authenticated === false) return "sign-in-required";
  return "unknown";
}

export const FIRST_RUN_CONNECTION_COPY = {
  missing: "home.firstRun.missing",
  "probe-failed": "home.firstRun.probeFailed",
  "signed-in": "home.firstRun.signedIn",
  "sign-in-required": "home.firstRun.signIn",
  unknown: "home.firstRun.unknown",
} as const satisfies Record<ReturnType<typeof firstRunConnectionState>, MessageKey>;
