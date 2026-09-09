export type PlaywrightInstallState =
  | "idle"
  | "installing"
  | "success"
  | "error";

export interface PlaywrightInstallStatus {
  state: PlaywrightInstallState;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  error: string | null;
  /** Tail of stdout+stderr lines (most recent last). Capped server-side. */
  tail: string[];
}

/**
 * Python / pypdf runtime health surfaced on the Settings modal so a
 * user can see whether PDF/PPTX DS uploads will work before they
 * actually click Upload.
 */
export interface PythonHealth {
  python: {
    found: boolean;
    /** The executable prefix that resolved, e.g. ["py", "-3"] or ["python3"]. */
    executable: string[] | null;
    /** First line of `python --version` output, e.g. "Python 3.13.5". */
    version: string | null;
  };
  pypdf: {
    /** `import pypdf` succeeded. */
    found: boolean;
    version: string | null;
    /** The installed release is the reviewed minimum or newer; older builds are refused by the extractor. */
    supported: boolean;
    required_version: string;
  };
  checked_at: number;
}

export type PypdfInstallState =
  | "idle"
  | "installing"
  | "success"
  | "error";

export interface PypdfInstallStatus {
  state: PypdfInstallState;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  error: string | null;
  tail: string[];
}

export interface PythonSettings {
  health: PythonHealth;
  install: PypdfInstallStatus;
}
