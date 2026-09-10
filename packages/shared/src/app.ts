export const APP_NAME = "BurnGuard Design";

// Single source of truth for the displayed app version.
// When cutting a release, bump this in lockstep with the root
// `package.json` and every `packages/<name>/package.json`. These
// should always agree — verified manually at release time.
export const APP_VERSION = "0.5.9";

export type BackendId = "claude-code" | "codex";
export type ProjectType =
  | "prototype"
  | "slide_deck"
  | "graphic"
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
