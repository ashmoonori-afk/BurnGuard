import type {
  BackendId,
  DesignSystemStatus,
  ProjectType,
  ThemeMode,
} from "./app";
import type { DesignBriefV1 } from "./design-brief";
import type { GraphicCanvasV1, GraphicSetV1 } from "./graphic";
import type { LogoSetV1 } from "./logo";

export interface ProjectSummary {
  id: string;
  name: string;
  type: ProjectType;
  design_system_id: string | null;
  design_system_name: string | null;
  thumbnail_path: string | null;
  updated_at: number;
  archived_at: number | null;
}

/** A deleted project still restorable from "Recently deleted"; never carries a filesystem path. */
export interface RecentlyDeletedProject {
  id: string;
  name: string;
  deleted_at: number;
}

export interface DesignSystemSummary {
  id: string;
  name: string;
  status: DesignSystemStatus;
  is_template: boolean;
  thumbnail_path: string | null;
  /** Latest available output preview for each project format. */
  thumbnail_paths?: Partial<Record<ProjectType, string>>;
  updated_at: number;
}

export interface CreateProjectRequest {
  name: string;
  type: ProjectType;
  design_system_id: string | null;
  backend_id: BackendId;
  options?: {
    use_speaker_notes?: boolean;
    copy_as_is?: boolean;
    design_brief?: DesignBriefV1;
    graphic_canvas?: GraphicCanvasV1;
    graphic_set?: GraphicSetV1;
    logo_set?: LogoSetV1;
  };
}

export interface CreateProjectResponse {
  id: string;
  session_id: string;
  dir_path: string;
  entrypoint: string;
}

export interface BackendDetection {
  authenticated?: boolean;
  /** The CLI can generate raster imagery at all; a model may still override this per entry. */
  image_generation?: boolean;
  models?: readonly import("./generation").GenerationModel[];
  id: BackendId;
  found: boolean;
  version?: string;
  /** The binary is on PATH but `--version` failed, timed out or printed no version: installed, not known to run. */
  probe_failed?: boolean;
  binary_path?: string;
  install_hint?: string;
}

export interface BackendDetectionResult {
  backends: BackendDetection[];
}

export interface SettingsSummary {
  generation_defaults?: Partial<Record<BackendId, import("./generation").GenerationOptions>>;
  commandcode_api_key_set?: boolean;
  /** Always returned by current servers; optional for older settings payloads. */
  llm_connections?: import("./connections").LlmConnectionSummary[];
  user: {
    id: "local";
    display_name: string;
  };
  app_version: string;
  default_backend: BackendId;
  theme: ThemeMode;
  /** Portable user preference. Null means an older browser choice has not been migrated yet. */
  locale: "ko" | "en" | "zh-CN" | null;
  /**
   * Minimum time (ms) a single CLI turn must be running before the
   * composer surfaces an Interrupt button. Local CLIs routinely take
   * tens of seconds on a cold start, so the button stays hidden until
   * the wait is long enough to feel wrong.
   */
  chat_abort_threshold_ms: number;
  chat_context_mode: "compact" | "full";
  /**
   * Whether a Figma Personal Access Token is configured. The actual
   * token never leaves the server — only this boolean is exposed via
   * GET /api/settings, so the UI can show "set / not set" without ever
   * holding the secret.
   */
  figma_token_set: boolean;
  /** Whether a Vercel token is saved locally; the token itself is never returned. */
  vercel_token_set: boolean;
  /** Default for the "Made with BurnGuard" badge on published web projects. */
  publish_made_with_badge: boolean;
  /**
   * Whether models without an image tool (Claude Opus/Sonnet) may search Openverse and Iconify for real,
   * licensed assets. Off means no search query leaves the machine.
   */
  web_asset_search: boolean;
  /**
   * Effective OS-local Codex progress signal: Codex usage metrics go to BurnGuard on this computer so
   * a turn that is still streaming is not mistaken for a stall. On by default; without an explicit
   * choice it is off while `codex_user_otel_configured` is true. PATCH stores an explicit choice.
   */
  codex_progress_metrics: boolean;
  /**
   * Detected on read, never stored: the user already has their own Codex OpenTelemetry destination
   * (an `[otel]` exporter in the Codex config, or `OTEL_EXPORTER_OTLP_*` in the backend environment).
   * While the signal is on, that destination does not receive Codex metrics.
   */
  codex_user_otel_configured: boolean;
}

export type SettingsPatch = Partial<
  Pick<
    SettingsSummary,
    | "default_backend"
    | "theme"
    | "locale"
    | "chat_abort_threshold_ms"
    | "chat_context_mode"
    | "generation_defaults"
    | "publish_made_with_badge"
    | "web_asset_search"
    | "codex_progress_metrics"
  > & {
    user: Partial<SettingsSummary["user"]>;
    /**
     * Write-only on PATCH /api/settings. Pass a string to set / replace
     * the Figma PAT; pass null to clear it. The summary that comes back
     * never includes the value — only the figma_token_set boolean.
     */
    figma_personal_access_token: string | null;
    /** Write-only; a string saves the Vercel token, null or "" clears it. */
    vercel_token: string | null;
    commandcode_api_key: string | null;
    llm_api_keys: import("./connections").LlmApiKeysPatch;
  }
>;
