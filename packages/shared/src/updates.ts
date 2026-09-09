/**
 * Application self-update status exposed by the backend. On Windows the native
 * shell owns the Velopack update flow; on macOS the backend drives the bundled
 * Velopack updater itself and the web UI shows this status.
 */
export type AppUpdateState = "unsupported" | "idle" | "checking" | "downloading" | "ready" | "error";

export type AppUpdateUnsupportedReason = "platform" | "not_installed" | "windows_shell";

export interface AppUpdateStatus {
  /** This process can check, download and apply a Velopack update itself. */
  supported: boolean;
  unsupported_reason: AppUpdateUnsupportedReason | null;
  state: AppUpdateState;
  current_version: string;
  /** Newest published version found by the last check; staged when `state` is `ready`. */
  available_version: string | null;
  /** Download progress in percent while `state` is `downloading`. */
  progress: number | null;
  checked_at: number | null;
  error: string | null;
}
