import type {
  BackendId,
  DesignSystemStatus,
  ProjectType,
  ThemeMode,
} from "./app";
import type { DesignBriefV1 } from "./design-brief";
import type { GraphicCanvasV1, GraphicSetV1 } from "./graphic";

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

export interface DesignSystemSummary {
  id: string;
  name: string;
  status: DesignSystemStatus;
  is_template: boolean;
  thumbnail_path: string | null;
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
  models?: readonly import("./generation").GenerationModel[];
  id: BackendId;
  found: boolean;
  version?: string;
  binary_path?: string;
  install_hint?: string;
}

export interface BackendDetectionResult {
  backends: BackendDetection[];
}

export interface SettingsSummary {
  generation_defaults?: Partial<Record<BackendId, import("./generation").GenerationOptions>>;
  commandcode_api_key_set?: boolean;
  user: {
    id: "local";
    display_name: string;
  };
  app_version: string;
  default_backend: BackendId;
  theme: ThemeMode;
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
}

export type SettingsPatch = Partial<
  Pick<
    SettingsSummary,
    | "default_backend"
    | "theme"
    | "chat_abort_threshold_ms"
    | "chat_context_mode"
    | "generation_defaults"
  > & {
    user: Partial<SettingsSummary["user"]>;
    /**
     * Write-only on PATCH /api/settings. Pass a string to set / replace
     * the Figma PAT; pass null to clear it. The summary that comes back
     * never includes the value — only the figma_token_set boolean.
     */
    figma_personal_access_token: string | null;
    commandcode_api_key: string | null;
  }
>;
