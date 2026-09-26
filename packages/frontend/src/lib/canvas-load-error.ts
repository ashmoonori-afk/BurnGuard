import type { MessageKey } from "@/i18n/t";

/**
 * The artifact fetch is a plain HTTP read, so its status is the only signal:
 * 409 is the managed-file identity window (re-index or a publication in flight),
 * 404 a missing file, 401/403 an expired authority. Everything else is a connection problem.
 */
export function canvasLoadErrorKey(status: number | undefined): MessageKey {
  if (status === 409) return "workspace.canvas.identityUnavailable";
  if (status === 404) return "workspace.canvas.fileNotFound";
  if (status === 401 || status === 403) return "workspace.canvas.unauthorized";
  return "workspace.canvas.connectionError";
}
