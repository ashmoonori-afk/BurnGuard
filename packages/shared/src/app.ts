export const APP_NAME = "BurnGuard Design";

// Single source of truth for the displayed app version.
// When cutting a release, bump this in lockstep with the root
// `package.json` and every `packages/<name>/package.json`. These
// should always agree — verified manually at release time.
export const APP_VERSION = "0.5.24";

/** Every CLI provider this app can drive. Detection, the adapter registry and the picker all read it. */
export const BACKEND_IDS = ["claude-code", "codex", "gemini", "copilot"] as const;
export type BackendId = (typeof BACKEND_IDS)[number];
export type ProjectType =
  | "prototype"
  | "slide_deck"
  | "graphic"
  | "logo"
  | "from_template"
  | "other";
export type DesignSystemStatus = "draft" | "review" | "published";
export type ThemeMode = "light" | "dark" | "auto";

export interface HealthResponse {
  ok: true;
  name: typeof APP_NAME;
  version: typeof APP_VERSION;
  uptimeMs: number;
  runtime: "bun" | "node";
  platform: string;
}
